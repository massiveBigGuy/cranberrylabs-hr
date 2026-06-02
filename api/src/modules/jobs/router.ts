import { Router } from 'express';
import type { AppContext } from '../types';
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

    const rawSort = req.query.sort;
    const sortBy: 'fit' | 'date' = rawSort === 'date' ? 'date' : 'fit';

    const opts: ListJobsOptions = {
      userId,
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
    const keywordFilter = {
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
    res.json({ job, tags: jobTags });
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
    const signals = ctx.config.scraper?.filters?.target_keywords ?? [];
    const excludes = ctx.config.scraper?.filters?.excluded_keywords ?? [];
    const result = computeFitScore(job, signals, excludes);
    jobs.updateFitScore(id, result.score, JSON.stringify(result.reasons));
    const updated = jobs.get(id);
    res.json({ job: updated, fit_score: result.score, fit_reasons: result.reasons });
  });

  return router;
}
