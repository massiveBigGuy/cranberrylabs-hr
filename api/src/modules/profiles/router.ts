import { Router } from 'express';
import type { AppContext } from '../types';
import { ProfilesRepo } from './repo';
import { JobsRepo } from '../jobs/repo';
import { computeFitScore } from '../jobs/fit-scorer';
import { requireRole } from '../../middleware/requireRole';

export function buildProfilesRouter(ctx: AppContext): Router {
  const router = Router();
  const profiles = new ProfilesRepo(ctx.db);
  const jobs = new JobsRepo(ctx.db);

  function parseId(raw: string | string[] | undefined): number | null {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  // GET /api/profiles — list current user's profiles (default first)
  router.get('/', (req, res) => {
    res.json({ profiles: profiles.list(req.user!.username) });
  });

  // POST /api/profiles — create new profile
  router.post('/', requireRole('user'), (req, res) => {
    const userId = req.user!.username;
    const body = (req.body ?? {}) as {
      name?: unknown;
      target_keywords?: unknown;
      excluded_keywords?: unknown;
      resume_version_id?: unknown;
    };

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'name required' });
      return;
    }

    const targetKws = Array.isArray(body.target_keywords)
      ? (body.target_keywords as unknown[]).filter((k): k is string => typeof k === 'string')
      : null;
    const excludedKws = Array.isArray(body.excluded_keywords)
      ? (body.excluded_keywords as unknown[]).filter((k): k is string => typeof k === 'string')
      : null;
    const resumeVersionId =
      typeof body.resume_version_id === 'number' ? body.resume_version_id : null;

    try {
      const profile = profiles.insert(userId, {
        name,
        target_keywords: targetKws,
        excluded_keywords: excludedKws,
        resume_version_id: resumeVersionId,
      });
      res.status(201).json({ profile });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.status(409).json({ error: `a profile named '${name}' already exists` });
        return;
      }
      throw err;
    }
  });

  // GET /api/profiles/:id — detail + counts
  router.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const profile = profiles.get(id);
    if (!profile || profile.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({
      profile,
      source_count: profiles.countSources(id),
      job_count: profiles.countJobs(id),
      sample_count: profiles.countWritingSamples(id),
    });
  });

  // PATCH /api/profiles/:id — update name / keywords / resume_version_id / is_default
  router.patch('/:id', requireRole('user'), (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const existing = profiles.get(id);
    if (!existing || existing.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: {
      name?: string;
      target_keywords?: string[] | null;
      excluded_keywords?: string[] | null;
      resume_version_id?: number | null;
      is_default?: boolean;
    } = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        res.status(400).json({ error: 'name must be a non-empty string' });
        return;
      }
      patch.name = body.name.trim();
    }
    if (body.target_keywords !== undefined) {
      patch.target_keywords = Array.isArray(body.target_keywords)
        ? (body.target_keywords as unknown[]).filter((k): k is string => typeof k === 'string')
        : null;
    }
    if (body.excluded_keywords !== undefined) {
      patch.excluded_keywords = Array.isArray(body.excluded_keywords)
        ? (body.excluded_keywords as unknown[]).filter((k): k is string => typeof k === 'string')
        : null;
    }
    if (body.resume_version_id !== undefined) {
      patch.resume_version_id =
        typeof body.resume_version_id === 'number' ? body.resume_version_id : null;
    }
    if (body.is_default === true) {
      patch.is_default = true;
    }

    try {
      const updated = profiles.update(id, req.user!.username, patch);
      if (!updated) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.json({ profile: updated });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.status(409).json({ error: `a profile with that name already exists` });
        return;
      }
      throw err;
    }
  });

  // DELETE /api/profiles/:id — refuses if default or has sources attached
  router.delete('/:id', requireRole('user'), (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const existing = profiles.get(id);
    if (!existing || existing.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (existing.is_default) {
      res.status(400).json({ error: 'cannot delete the default profile' });
      return;
    }
    const sourceCount = profiles.countSources(id);
    if (sourceCount > 0) {
      res.status(400).json({
        error: `profile has ${sourceCount} source(s) attached; reassign them before deleting`,
      });
      return;
    }
    profiles.delete(id);
    res.status(204).end();
  });

  // POST /api/profiles/:id/refit — recompute fit_score for every job in this profile
  router.post('/:id/refit', requireRole('user'), (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const profile = profiles.get(id);
    if (!profile || profile.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const signals: string[] = profile.target_keywords
      ? (JSON.parse(profile.target_keywords) as string[])
      : [];
    const excludes: string[] = profile.excluded_keywords
      ? (JSON.parse(profile.excluded_keywords) as string[])
      : [];

    const jobRows = ctx.db
      .prepare(
        `SELECT j.id, j.title, j.description FROM jobs j
         JOIN sources s ON j.source_id = s.id
         WHERE s.profile_id = ?
           AND j.description IS NOT NULL AND j.description != ''`,
      )
      .all(id) as { id: number; title: string; description: string }[];

    for (const job of jobRows) {
      const result = computeFitScore(job, signals, excludes);
      jobs.updateFitScore(job.id, result.score, JSON.stringify(result.reasons));
    }

    res.json({ updated: jobRows.length, profile_id: id });
  });

  return router;
}
