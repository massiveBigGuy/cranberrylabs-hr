import { Router } from 'express';
import type { AppContext } from '../types';
import type { DB } from '../../services/db';
import { JobsRepo, isJobStatus, type JobStatus, type ListJobsOptions } from './repo';
import { TagsRepo } from './repo-tags';
import { computeFitScore } from './fit-scorer';

export function buildJobsRouter(ctx: AppContext): Router {
  const router = Router();
  const jobs = new JobsRepo(ctx.db);
  const tags = new TagsRepo(ctx.db);

  function parseStatuses(raw: unknown): JobStatus[] | undefined {
    if (typeof raw !== 'string' || !raw.trim()) return undefined;
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const ok = parts.filter(isJobStatus);
    return ok.length > 0 ? ok : undefined;
  }

  function parseTagIds(raw: unknown): number[] | undefined {
    if (typeof raw !== 'string' || !raw.trim()) return undefined;
    const names = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const ids: number[] = [];
    for (const n of names) {
      const t = tags.findByName(n);
      if (t) ids.push(t.id);
    }
    return ids.length > 0 ? ids : undefined;
  }

  function parseNumberOpt(raw: unknown): number | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  // GET /api/jobs
  router.get('/', (req, res) => {
    const userId = req.user!.username;
    const applyKeywordFilter = req.query.filter !== 'off';
    const profileId = parseNumberOpt(req.query.profile_id);

    const rawSort = req.query.sort;
    const sortBy: 'fit' | 'date' = rawSort === 'date' ? 'date' : 'fit';

    // Resolve keyword filter from the requested profile (if specified) or the
    // user's default profile. Falls back to scraper.filters config when no
    // profiles exist yet (e.g. fresh deploy before first boot with 7.2).
    let keywordFilter: { include?: string[]; exclude?: string[] } | undefined;
    if (applyKeywordFilter) {
      const profileKws = resolveProfileKeywords(ctx.db, userId, profileId);
      keywordFilter = profileKws ?? {
        include: ctx.config.scraper?.filters?.target_keywords ?? [],
        exclude: ctx.config.scraper?.filters?.excluded_keywords ?? [],
      };
    }

    const opts: ListJobsOptions = {
      userId,
      statuses: parseStatuses(req.query.status),
      since: typeof req.query.since === 'string' ? req.query.since : undefined,
      minFit: parseNumberOpt(req.query.min_fit),
      tagIds: parseTagIds(req.query.tag),
      sourceId: parseNumberOpt(req.query.source_id),
      profileId,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      limit: parseNumberOpt(req.query.limit),
      offset: parseNumberOpt(req.query.offset),
      sortBy,
      applyKeywordFilter,
      keywordFilter,
    };

    if (!opts.statuses && req.query.status !== 'all') {
      opts.statuses = ['new', 'reviewing', 'queued', 'generating', 'ready', 'applied'];
    } else if (req.query.status === 'all') {
      opts.statuses = undefined;
    }

    const result = jobs.list(opts);
    res.json(result);
  });

  // GET /api/jobs/stats — must register before /:id
  router.get('/stats', (req, res) => {
    const userId = req.user!.username;
    // Use default profile keywords; fall back to config when no profiles exist.
    const keywordFilter =
      resolveProfileKeywords(ctx.db, userId, undefined) ?? {
        include: ctx.config.scraper?.filters?.target_keywords ?? [],
        exclude: ctx.config.scraper?.filters?.excluded_keywords ?? [],
      };
    const stats = jobs.stats(userId, keywordFilter);
    res.json(stats);
  });

  // GET /api/jobs/:id
  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const job = jobs.get(id);
    if (!job || job.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const jobTags = jobs.tagsFor(id);
    // Derived profile: resolved via source_id → sources.profile_id → profiles
    const profile =
      (ctx.db
        .prepare(
          `SELECT p.* FROM profiles p
           JOIN sources s ON s.profile_id = p.id
           WHERE s.id = ?`,
        )
        .get(job.source_id) as Record<string, unknown> | undefined) ?? null;
    res.json({ job, tags: jobTags, profile });
  });

  // PATCH /api/jobs/:id
  router.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const job = jobs.get(id);
    if (!job || job.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const body = (req.body ?? {}) as {
      status?: unknown;
      dismissed_reason?: unknown;
      hiring_manager?: unknown;
      hiring_manager_source?: unknown;
    };

    let updated = job;

    if (body.status !== undefined) {
      if (!isJobStatus(body.status)) {
        res.status(400).json({ error: 'invalid status', allowed: 'see §3 of schema' });
        return;
      }
      const reason =
        typeof body.dismissed_reason === 'string' ? body.dismissed_reason : null;
      updated = jobs.updateStatus(id, body.status, reason) ?? updated;
    }

    if (body.hiring_manager !== undefined) {
      const name =
        typeof body.hiring_manager === 'string' && body.hiring_manager.trim()
          ? body.hiring_manager.trim()
          : null;
      const src =
        typeof body.hiring_manager_source === 'string'
          ? body.hiring_manager_source
          : name
          ? 'manual'
          : null;
      updated = jobs.updateHiringManager(id, name, src) ?? updated;
    }

    res.json({ job: updated });
  });

  // POST /api/jobs/:id/dismiss
  router.post('/:id/dismiss', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const job = jobs.get(id);
    if (!job || job.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : null;
    const updated = jobs.updateStatus(id, 'dismissed', reason);
    res.json({ job: updated });
  });

  // POST /api/jobs/:id/tags
  router.post('/:id/tags', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const job = jobs.get(id);
    if (!job || job.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const name = typeof req.body?.tag === 'string' ? req.body.tag : '';
    const color = typeof req.body?.color === 'string' ? req.body.color : null;
    if (!name.trim()) {
      res.status(400).json({ error: 'tag name required' });
      return;
    }
    try {
      const tag = tags.upsert(name, color);
      tags.attach(id, tag.id);
      res.status(201).json({ tag });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // DELETE /api/jobs/:id/tags/:tagId
  router.delete('/:id/tags/:tagId', (req, res) => {
    const id = Number(req.params.id);
    const tagId = Number(req.params.tagId);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(tagId) || tagId <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const job = jobs.get(id);
    if (!job || job.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const removed = tags.detach(id, tagId);
    if (!removed) {
      res.status(404).json({ error: 'tag not attached to this job' });
      return;
    }
    res.status(204).end();
  });

  // POST /api/jobs/:id/refit
  router.post('/:id/refit', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const job = jobs.get(id);
    if (!job || job.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!job.description) {
      res.status(400).json({ error: 'job has no description yet' });
      return;
    }
    // Use the job's derived profile keywords; fall back to config.
    const profileKws = resolveJobProfileKeywords(ctx.db, id);
    const signals =
      profileKws?.include ?? ctx.config.scraper?.filters?.target_keywords ?? [];
    const excludes =
      profileKws?.exclude ?? ctx.config.scraper?.filters?.excluded_keywords ?? [];
    const result = computeFitScore(job, signals, excludes);
    jobs.updateFitScore(id, result.score, JSON.stringify(result.reasons));
    const updated = jobs.get(id);
    res.json({ job: updated, fit_score: result.score, fit_reasons: result.reasons });
  });

  return router;
}

// --- profile keyword helpers -----------------------------------------------

type KeywordFilter = { include: string[]; exclude: string[] };
type ProfileKwRow = { target_keywords: string | null; excluded_keywords: string | null };

/**
 * Returns keyword filter from the given profile (or the user's default profile
 * when profileId is omitted). Returns undefined if no profile exists yet.
 */
function resolveProfileKeywords(
  db: DB,
  userId: string,
  profileId: number | undefined,
): KeywordFilter | undefined {
  const row = (
    profileId !== undefined
      ? db
          .prepare(
            'SELECT target_keywords, excluded_keywords FROM profiles WHERE id = ? AND user_id = ?',
          )
          .get(profileId, userId)
      : db
          .prepare(
            'SELECT target_keywords, excluded_keywords FROM profiles WHERE user_id = ? AND is_default = 1',
          )
          .get(userId)
  ) as ProfileKwRow | undefined;

  if (!row) return undefined;
  return {
    include: row.target_keywords ? (JSON.parse(row.target_keywords) as string[]) : [],
    exclude: row.excluded_keywords ? (JSON.parse(row.excluded_keywords) as string[]) : [],
  };
}

/**
 * Returns keyword filter from a specific job's derived profile
 * (job → source → profile). Returns undefined if no profile is attached.
 */
function resolveJobProfileKeywords(
  db: DB,
  jobId: number,
): KeywordFilter | undefined {
  const row = db
    .prepare(
      `SELECT p.target_keywords, p.excluded_keywords FROM profiles p
       JOIN sources s ON s.profile_id = p.id
       JOIN jobs j ON j.source_id = s.id
       WHERE j.id = ?`,
    )
    .get(jobId) as ProfileKwRow | undefined;

  if (!row) return undefined;
  return {
    include: row.target_keywords ? (JSON.parse(row.target_keywords) as string[]) : [],
    exclude: row.excluded_keywords ? (JSON.parse(row.excluded_keywords) as string[]) : [],
  };
}
