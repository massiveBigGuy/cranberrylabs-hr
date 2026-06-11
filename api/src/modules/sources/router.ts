import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Queue } from 'bullmq';
import type { AppContext } from '../types';
import { SourcesRepo, type Platform } from './repo';
import { ProfilesRepo } from '../profiles/repo';
import { parseWorkdayUrl } from '../scraper/url-parser';
import type { ScrapeJobData } from '../scraper/worker';
import { ScrapeRunsRepo } from '../scraper/repo-runs';

export function buildSourcesRouter(
  ctx: AppContext,
  getScrapeQueue: () => Queue<ScrapeJobData>,
): Router {
  const router = Router();
  const sources = new SourcesRepo(ctx.db);
  const profilesRepo = new ProfilesRepo(ctx.db);
  const runs = new ScrapeRunsRepo(ctx.db);

  router.get('/', (req, res) => {
    res.json({ sources: sources.list(req.user!.username) });
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.username;
      const { company_name, platform, tenant_url, search_params, profile_id } = req.body ?? {};
      const v = validateNewSource({ company_name, platform, tenant_url });
      if (!v.ok) {
        res.status(400).json({ error: v.error });
        return;
      }
      if (sources.findByTenantUrl(v.tenant_url, userId)) {
        res.status(409).json({ error: 'a source with this tenant_url already exists' });
        return;
      }

      // profile_id defaults to the user's default profile when omitted so
      // existing source-creation clients keep working without change.
      let resolvedProfileId: number | null = null;
      if (typeof profile_id === 'number') {
        resolvedProfileId = profile_id;
      } else {
        const defaultProfile = profilesRepo.getDefault(userId);
        resolvedProfileId = defaultProfile?.id ?? null;
      }

      const row = sources.insert(
        {
          company_name: v.company_name,
          platform: v.platform,
          tenant_url: v.tenant_url,
          search_params: search_params ?? null,
          profile_id: resolvedProfileId,
        },
        userId,
      );

      await getScrapeQueue().add('probe', { source_id: row.id, mode: 'probe' });

      res.status(201).json({ source: row, probe_status: 'pending' });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const row = sources.get(id);
    if (!row || row.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ source: row });
  });

  router.patch('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const existing = sources.get(id);
    if (!existing || existing.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const { company_name, enabled, search_params, profile_id } = req.body ?? {};
    const updated = sources.update(id, {
      ...(company_name !== undefined && { company_name }),
      ...(enabled !== undefined && { enabled: !!enabled }),
      ...(search_params !== undefined && { search_params }),
      ...(profile_id !== undefined && {
        profile_id: typeof profile_id === 'number' ? profile_id : null,
      }),
    });
    res.json({ source: updated });
  });

  router.delete('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const existing = sources.get(id);
    if (!existing || existing.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    sources.delete(id);
    res.status(204).end();
  });

  router.post('/:id/scrape', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'invalid id' });
        return;
      }
      const source = sources.get(id);
      if (!source || source.user_id !== req.user!.username) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      const job = await getScrapeQueue().add('listing', {
        source_id: id,
        mode: 'listing',
      });
      res.status(202).json({ accepted: true, queue_job_id: job.id, source_id: id });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/test', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'invalid id' });
        return;
      }
      const source = sources.get(id);
      if (!source || source.user_id !== req.user!.username) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      const job = await getScrapeQueue().add('probe', { source_id: id, mode: 'probe' });
      res.status(202).json({ accepted: true, queue_job_id: job.id });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/runs', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const source = sources.get(id);
    if (!source || source.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    res.json({ runs: runs.recentForSource(id, limit) });
  });

  return router;
}

// --- helpers ------------------------------------------------------------

function parseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

interface ValidatedInput {
  company_name: string;
  platform: Platform;
  tenant_url: string;
}

type ValidationResult =
  | { ok: true; company_name: string; platform: Platform; tenant_url: string }
  | { ok: false; error: string };

function validateNewSource(input: Partial<ValidatedInput>): ValidationResult {
  if (typeof input.company_name !== 'string' || !input.company_name.trim()) {
    return { ok: false, error: 'company_name is required' };
  }
  if (typeof input.platform !== 'string') {
    return { ok: false, error: 'platform is required' };
  }
  const platform = input.platform.toLowerCase() as Platform;
  if (!['workday', 'greenhouse', 'lever', 'icims', 'custom'].includes(platform)) {
    return { ok: false, error: `unsupported platform '${input.platform}'` };
  }
  if (typeof input.tenant_url !== 'string' || !input.tenant_url.trim()) {
    return { ok: false, error: 'tenant_url is required' };
  }
  if (platform === 'workday') {
    const parsed = parseWorkdayUrl(input.tenant_url);
    if (!parsed.ok) return { ok: false, error: `invalid workday URL: ${parsed.error}` };
  }
  return {
    ok: true,
    company_name: input.company_name.trim(),
    platform,
    tenant_url: input.tenant_url.trim(),
  };
}
