import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../types';
import type { LLMAdapter } from '../../services/llm';
import { ApplicationsRepo, isApplicationStatus } from './repo';
import { ResumeRepo } from '../resume/repo';
import { generateApplication } from './generator';
import { bus } from '../../services/sse/bus';

export function buildApplicationsRouter(ctx: AppContext, adapter: LLMAdapter): Router {
  const router = Router();
  const apps = new ApplicationsRepo(ctx.db);
  const resume = new ResumeRepo(ctx.db);
  const storageRoot = path.resolve(ctx.config.storage.root);

  // GET /api/applications — list; optional ?status= and ?job_id=
  router.get('/', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const jobIdRaw = req.query.job_id;
    const jobId =
      jobIdRaw !== undefined ? Number(jobIdRaw) : undefined;

    const list = apps.list({
      status: isApplicationStatus(status) ? status : undefined,
      jobId: Number.isInteger(jobId) && jobId! > 0 ? jobId : undefined,
    });
    res.json({ applications: list });
  });

  // POST /api/applications — generate for a job (synchronous, step 6)
  router.post('/', async (req, res) => {
    const rawId = req.body?.job_id;
    const jobId = typeof rawId === 'number' ? rawId : Number(rawId);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      res.status(400).json({ error: 'job_id is required and must be a positive integer' });
      return;
    }

    const existing = apps.getByJobId(jobId);
    if (existing) {
      res.status(409).json({
        error: 'an application already exists for this job',
        application: existing,
      });
      return;
    }

    const activeResume = resume.getActive();
    if (!activeResume) {
      res.status(400).json({
        error: 'no active master resume — add one at /resume before generating',
      });
      return;
    }

    const jobRow = ctx.db
      .prepare('SELECT id, title, company, description FROM jobs WHERE id = ?')
      .get(jobId) as
      | { id: number; title: string; company: string; description: string }
      | undefined;

    if (!jobRow) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    if (!jobRow.description) {
      res.status(400).json({
        error: 'job has no description yet — wait for the detail sweep or re-check later',
      });
      return;
    }

    const samples = resume.listWritingSamples();
    const userId = req.user?.username ?? 'unknown';

    const app = apps.create(jobId, userId, activeResume.id);
    apps.addEvent(app.id, 'generation.started', { model: ctx.config.llm.anthropic.model });
    bus.publish('application.started', { applicationId: app.id, jobId });

    try {
      const output = await generateApplication(
        app.id,
        jobRow,
        activeResume,
        samples,
        adapter,
        storageRoot,
      );

      const updated = apps.updateGenerated(app.id, {
        modelUsed: output.modelUsed,
        resumePath: output.resumePath,
        coverPath: output.coverPath,
        diff: output.diff,
        resumeVersionId: activeResume.id,
      });

      // Advance job status to ready (don't clobber applied/archived)
      ctx.db
        .prepare(
          `UPDATE jobs SET status = 'ready'
           WHERE id = ? AND status NOT IN ('applied', 'archived', 'dismissed')`,
        )
        .run(jobId);

      apps.addEvent(app.id, 'generation.completed', {
        model: output.modelUsed,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
      });
      bus.publish('application.ready', { applicationId: app.id, jobId });

      ctx.logger.info('applications: generation complete', {
        appId: app.id,
        jobId,
        model: output.modelUsed,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
      });

      res.status(201).json({ application: updated ?? app });
    } catch (err) {
      const msg = (err as Error).message;
      ctx.logger.warn('applications: generation failed', { appId: app.id, jobId, error: msg });
      apps.updateFailed(app.id, msg);
      apps.addEvent(app.id, 'generation.failed', { error: msg });
      bus.publish('application.failed', { applicationId: app.id, jobId, error: msg });
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/applications/queue — step 7 placeholder
  // Must be registered before /:id so 'queue' isn't swallowed by the wildcard.
  router.get('/queue', (_req, res) => {
    res.status(501).json({ error: 'queue view is not yet implemented (step 7)' });
  });

  // GET /api/applications/:id — detail
  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const app = apps.get(id);
    if (!app) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ application: app });
  });

  // GET /api/applications/:id/cover — serve cover letter file
  // Must be before /:id/regenerate and /:id/submit so Express doesn't
  // misroute the literal segment 'cover'.
  router.get('/:id/cover', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const app = apps.get(id);
    if (!app) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!app.cover_letter_path) {
      res.status(404).json({ error: 'cover letter not yet generated' });
      return;
    }
    const filePath = path.resolve(storageRoot, app.cover_letter_path);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'cover letter file not found on disk' });
      return;
    }
    const slug = app.job_company.replace(/\s+/g, '-').toLowerCase();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cover-letter-${slug}.txt"`);
    res.sendFile(filePath);
  });

  // GET /api/applications/:id/resume — serve tailored resume JSON
  router.get('/:id/resume', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const app = apps.get(id);
    if (!app) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!app.resume_path) {
      res.status(404).json({ error: 'tailored resume not yet generated' });
      return;
    }
    const filePath = path.resolve(storageRoot, app.resume_path);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'resume file not found on disk' });
      return;
    }
    const slug = app.job_company.replace(/\s+/g, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="resume-${slug}.json"`);
    res.sendFile(filePath);
  });

  // POST /api/applications/:id/regenerate — step 7 placeholder
  router.post('/:id/regenerate', (_req, res) => {
    res.status(501).json({ error: 'regenerate is not yet implemented (step 7)' });
  });

  // POST /api/applications/:id/submit — mark as applied
  router.post('/:id/submit', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const app = apps.get(id);
    if (!app) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const notes =
      typeof req.body?.notes === 'string' && req.body.notes.trim()
        ? req.body.notes.trim()
        : null;
    const updated = apps.submit(id, notes);

    ctx.db.prepare(`UPDATE jobs SET status = 'applied' WHERE id = ?`).run(app.job_id);
    apps.addEvent(id, 'submitted', { notes });

    res.json({ application: updated ?? app });
  });

  // DELETE /api/applications/:id — delete + clean up generated files
  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    if (!apps.get(id)) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const appDir = path.resolve(storageRoot, String(id));
    if (fs.existsSync(appDir)) {
      fs.rmSync(appDir, { recursive: true, force: true });
    }

    apps.delete(id);
    res.status(204).end();
  });

  return router;
}
