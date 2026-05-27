import { Router } from 'express';
import type { AppContext } from '../types';
import { JobsRepo, isJobStatus, type JobStatus, type ListJobsOptions } from './repo';
import { TagsRepo } from './repo-tags';
import { computeFitScore } from './fit-scorer';

/**
 * Builds the /api/jobs router. Endpoints per §4 of the schema:
 *
 *   GET    /api/jobs                  list with filters
 *   GET    /api/jobs/:id              detail + tags
 *   PATCH  /api/jobs/:id              update status / hiring_manager
 *   POST   /api/jobs/:id/tags         attach tag (find-or-create by name)
 *   DELETE /api/jobs/:id/tags/:tagId  detach tag
 *   POST   /api/jobs/:id/dismiss      shorthand for PATCH status=dismissed
 *   POST   /api/jobs/:id/refit        recompute fit_score — deferred to step 4
 *
 * The router receives the AppContext so it can read config (for the
 * keyword filter) and reach the DB.
 */
export function buildJobsRouter(ctx: AppContext): Router {
  const router = Router();
  const jobs = new JobsRepo(ctx.db);
  const tags = new TagsRepo(ctx.db);

  /**
   * Parse `?status=new,reviewing` into a list of validated statuses.
   * Invalid statuses are silently dropped — the alternative (400) is
   * brittle if the UI sends a status that's been renamed in a future
   * step. Drop-and-continue is forgiving without being incorrect.
   */
  function parseStatuses(raw: unknown): JobStatus[] | undefined {
    if (typeof raw !== 'string' || !raw.trim()) return undefined;
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const ok = parts.filter(isJobStatus);
    return ok.length > 0 ? ok : undefined;
  }

  /**
   * Parse `?tag=foo,bar` into tag IDs. Names that don't resolve are
   * dropped (returning [] would match no jobs and silently confuse).
   * The alternative — 404 on unknown tag — would block legitimate
   * "tag=remote,priority" calls if priority hasn't been created yet.
   */
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

  /**
   * Parse a query-string number. Returns undefined when missing/blank
   * or non-numeric. Used for both ints (limit, offset, source_id) and
   * floats (min_fit). Number() accepts both; the caller's column types
   * keep the values honest.
   */
  function parseNumberOpt(raw: unknown): number | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  // GET /api/jobs
  router.get('/', (req, res) => {
    const applyKeywordFilter = req.query.filter !== 'off';
    // ^ default: apply config filter. ?filter=off bypasses it (for the
    //   /jobs/all view a future step will add).

    const rawSort = req.query.sort;
    const sortBy: 'fit' | 'date' =
      rawSort === 'date' ? 'date' : 'fit';
    // Default to fit sort — jobs with higher scores rise to the top.
    // Falls back gracefully when scores are all NULL (date order takes over).

    const opts: ListJobsOptions = {
      statuses: parseStatuses(req.query.status),
      since: typeof req.query.since === 'string' ? req.query.since : undefined,
      minFit: parseNumberOpt(req.query.min_fit),
      tagIds: parseTagIds(req.query.tag),
      sourceId: parseNumberOpt(req.query.source_id),
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      limit: parseNumberOpt(req.query.limit),
      offset: parseNumberOpt(req.query.offset),
      sortBy,
      applyKeywordFilter,
      keywordFilter: applyKeywordFilter
        ? {
            include: ctx.config.scraper?.filters?.target_keywords ?? [],
            exclude: ctx.config.scraper?.filters?.excluded_keywords ?? [],
          }
        : undefined,
    };

    // Default status filter when none specified: hide dismissed/archived
    // from the front-page view. The UI can show them explicitly by
    // requesting ?status=dismissed,archived or ?status=all (which we
    // map to "no filter").
    if (!opts.statuses && req.query.status !== 'all') {
      opts.statuses = ['new', 'reviewing', 'queued', 'generating', 'ready', 'applied'];
    } else if (req.query.status === 'all') {
      opts.statuses = undefined;
    }

    const result = jobs.list(opts);
    res.json(result);
  });

    // GET /api/jobs/stats — aggregate counts for the diagnostic panel.
  // Registered before /:id so the literal 'stats' isn't swallowed by
  // the :id wildcard.
  router.get('/stats', (_req, res) => {
    const keywordFilter = {
      include: ctx.config.scraper?.filters?.target_keywords ?? [],
      exclude: ctx.config.scraper?.filters?.excluded_keywords ?? [],
    };
    const stats = jobs.stats(keywordFilter);
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
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const jobTags = jobs.tagsFor(id);
    res.json({ job, tags: jobTags });
  });

  // PATCH /api/jobs/:id
  // Accepts: { status?, dismissed_reason?, hiring_manager?, hiring_manager_source? }
  router.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const job = jobs.get(id);
    if (!job) {
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
    if (!jobs.get(id)) {
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
  // Body: { tag: 'priority', color?: '#ff0' }
  router.post('/:id/tags', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    if (!jobs.get(id)) {
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
    const removed = tags.detach(id, tagId);
    if (!removed) {
      res.status(404).json({ error: 'tag not attached to this job' });
      return;
    }
    res.status(204).end();
  });

  // POST /api/jobs/:id/refit — recompute fit_score for a single job.
  router.post('/:id/refit', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const job = jobs.get(id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!job.description) {
      res.status(400).json({ error: 'job has no description yet' });
      return;
    }
    const signals = ctx.config.scraper?.filters?.target_keywords ?? [];
    const excludes = ctx.config.scraper?.filters?.excluded_keywords ?? [];
    const result = computeFitScore(job, signals, excludes);
    jobs.updateFitScore(id, result.score, JSON.stringify(result.reasons));
    const updated = jobs.get(id);
    res.json({ job: updated, fit_score: result.score, fit_reasons: result.reasons });
  });

  return router;
}
