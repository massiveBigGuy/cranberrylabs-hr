import { Router } from 'express';
import type { AppContext } from '../types';
import { ResumeRepo, isWritingSampleKind } from './repo';

/**
 * Builds the /api/resume router. Endpoints per §4 of schema-v2.md:
 *
 *   GET    /api/resume                          active master_resume (or null)
 *   GET    /api/resume/versions                 full version history
 *   POST   /api/resume                          create new version
 *   PATCH  /api/resume/:id/activate             switch active version
 *   GET    /api/resume/writing-samples          all writing samples
 *   POST   /api/resume/writing-samples          create sample
 *   PATCH  /api/resume/writing-samples/:id      update sample
 *   DELETE /api/resume/writing-samples/:id      remove sample
 *
 * Route ordering: static paths (/versions, /writing-samples) registered
 * before parametric ones (/:id/activate, /writing-samples/:id) so the
 * string literals aren't swallowed by wildcards.
 */
export function buildResumeRouter(ctx: AppContext): Router {
  const router = Router();
  const repo = new ResumeRepo(ctx.db);

  // GET /api/resume — active version, or null if none exists yet
  router.get('/', (_req, res) => {
    res.json({ resume: repo.getActive() });
  });

  // GET /api/resume/versions — full history, newest first
  router.get('/versions', (_req, res) => {
    res.json({ versions: repo.listVersions() });
  });

  // POST /api/resume — create new version (content must be valid JSON)
  router.post('/', (req, res) => {
    const body = (req.body ?? {}) as { content?: unknown; notes?: unknown };
    if (typeof body.content !== 'string' || !body.content.trim()) {
      res.status(400).json({ error: 'content required' });
      return;
    }
    try {
      JSON.parse(body.content);
    } catch {
      res.status(400).json({ error: 'content must be valid JSON' });
      return;
    }
    const notes =
      typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    const resume = repo.create(body.content.trim(), notes);
    res.status(201).json({ resume });
  });

  // PATCH /api/resume/:id/activate — switch active version
  router.patch('/:id/activate', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const resume = repo.activate(id);
    if (!resume) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ resume });
  });

  // GET /api/resume/writing-samples
  router.get('/writing-samples', (_req, res) => {
    res.json({ samples: repo.listWritingSamples() });
  });

  // POST /api/resume/writing-samples — { label, kind, content }
  router.post('/writing-samples', (req, res) => {
    const body = (req.body ?? {}) as { label?: unknown; kind?: unknown; content?: unknown };
    if (typeof body.label !== 'string' || !body.label.trim()) {
      res.status(400).json({ error: 'label required' });
      return;
    }
    if (!isWritingSampleKind(body.kind)) {
      res.status(400).json({ error: 'kind must be one of: cover_letter, email, bio, other' });
      return;
    }
    if (typeof body.content !== 'string' || !body.content.trim()) {
      res.status(400).json({ error: 'content required' });
      return;
    }
    const sample = repo.createWritingSample(body.label.trim(), body.kind, body.content);
    res.status(201).json({ sample });
  });

  // PATCH /api/resume/writing-samples/:id — partial update
  router.patch('/writing-samples/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const body = (req.body ?? {}) as {
      label?: unknown;
      kind?: unknown;
      content?: unknown;
      active?: unknown;
    };
    const patch: { label?: string; kind?: string; content?: string; active?: number } = {};

    if (body.label !== undefined) {
      if (typeof body.label !== 'string' || !body.label.trim()) {
        res.status(400).json({ error: 'label must be a non-empty string' });
        return;
      }
      patch.label = body.label.trim();
    }
    if (body.kind !== undefined) {
      if (!isWritingSampleKind(body.kind)) {
        res.status(400).json({ error: 'kind must be one of: cover_letter, email, bio, other' });
        return;
      }
      patch.kind = body.kind;
    }
    if (body.content !== undefined) {
      if (typeof body.content !== 'string' || !body.content.trim()) {
        res.status(400).json({ error: 'content must be a non-empty string' });
        return;
      }
      patch.content = body.content;
    }
    if (body.active !== undefined) {
      patch.active = body.active ? 1 : 0;
    }

    const sample = repo.updateWritingSample(id, patch);
    if (!sample) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ sample });
  });

  // DELETE /api/resume/writing-samples/:id
  router.delete('/writing-samples/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    if (!repo.deleteWritingSample(id)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.status(204).end();
  });

  return router;
}
