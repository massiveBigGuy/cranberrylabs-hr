import { Router } from 'express';
import type { AppContext } from '../types';
import type { RetentionRepo } from './repo';
import { nightlySweep } from './sweep';

export function buildRetentionRouter(ctx: AppContext, repo: RetentionRepo): Router {
  const router = Router();

  // GET /api/retention/policies
  router.get('/policies', (_req, res) => {
    res.json({ policies: repo.listPolicies() });
  });

  // POST /api/retention/policies — define a new policy
  router.post('/policies', (req, res) => {
    const { name, description, ttl_days } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const ttl =
      ttl_days === null || ttl_days === undefined
        ? null
        : typeof ttl_days === 'number'
          ? ttl_days
          : Number(ttl_days);
    if (ttl !== null && (!Number.isInteger(ttl) || ttl <= 0)) {
      res.status(400).json({ error: 'ttl_days must be a positive integer or null' });
      return;
    }
    try {
      const policy = repo.createPolicy({
        name: name.trim(),
        description: typeof description === 'string' ? description.trim() : null,
        ttl_days: ttl,
      });
      res.status(201).json({ policy });
    } catch {
      res.status(409).json({ error: 'a policy with that name already exists' });
    }
  });

  // PATCH /api/retention/policies/:id — update description or ttl_days
  router.patch('/policies/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const { description, ttl_days } = req.body ?? {};
    const data: { description?: string | null; ttl_days?: number | null } = {};
    if (description !== undefined) data.description = typeof description === 'string' ? description.trim() : null;
    if (ttl_days !== undefined) {
      data.ttl_days =
        ttl_days === null
          ? null
          : typeof ttl_days === 'number'
            ? ttl_days
            : Number(ttl_days);
    }
    const updated = repo.updatePolicy(id, data);
    if (!updated) {
      res.status(404).json({ error: 'policy not found' });
      return;
    }
    res.json({ policy: updated });
  });

  // GET /api/retention/runs — sweep run history
  router.get('/runs', (_req, res) => {
    res.json({ runs: repo.listRuns() });
  });

  // GET /api/retention/events — audit log; ?application_id= to filter
  router.get('/events', (req, res) => {
    const raw = req.query.application_id;
    const appId = raw !== undefined ? Number(raw) : undefined;
    const events = repo.listEvents(
      appId !== undefined && Number.isInteger(appId) && appId > 0 ? appId : undefined,
    );
    res.json({ events });
  });

  // POST /api/retention/sweep — manual trigger; responds immediately, sweep runs async
  router.post('/sweep', (_req, res) => {
    ctx.logger.info('retention: manual sweep triggered');
    nightlySweep(ctx, repo).catch((err: unknown) => {
      ctx.logger.error('retention: manual sweep error', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    res.json({ ok: true, message: 'sweep started' });
  });

  return router;
}
