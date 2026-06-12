import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { Queue } from 'bullmq';
import type { AppContext } from '../types';
import type { LLMAdapter } from '../../services/llm';
import type { GenerationJobData } from './worker';
import { ApplicationsRepo, isApplicationStatus } from './repo';
import { ResumeRepo } from '../resume/repo';
import { bus } from '../../services/sse/bus';

export function buildApplicationsRouter(
  ctx: AppContext,
  adapter: LLMAdapter,
  generationQueue: Queue<GenerationJobData>,
): Router {
  const router = Router();
  const apps = new ApplicationsRepo(ctx.db);
  const resume = new ResumeRepo(ctx.db);
  const storageRoot = path.resolve(ctx.config.storage.root);

  // GET /api/applications — list; optional ?status= and ?job_id=
  router.get('/', (req, res) => {
    const userId = req.user!.username;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const jobIdRaw = req.query.job_id;
    const jobId = jobIdRaw !== undefined ? Number(jobIdRaw) : undefined;

    const list = apps.list({
      userId,
      status: isApplicationStatus(status) ? status : undefined,
      jobId: Number.isInteger(jobId) && jobId! > 0 ? jobId : undefined,
    });
    res.json({ applications: list });
  });

  // POST /api/applications — enqueue generation for a job (returns 202 immediately)
  router.post('/', async (req, res) => {
    const userId = req.user!.username;
    const rawId = req.body?.job_id;
    const jobId = typeof rawId === 'number' ? rawId : Number(rawId);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      res.status(400).json({ error: 'job_id is required and must be a positive integer' });
      return;
    }

    const existing = apps.getByJobId(jobId, userId);
    if (existing) {
      res.status(409).json({
        error: 'an application already exists for this job',
        application: existing,
      });
      return;
    }

    const rawAdapter = req.body?.adapter;
    const adapterName: 'anthropic' | 'ollama' | undefined =
      rawAdapter === 'anthropic' || rawAdapter === 'ollama' ? rawAdapter : undefined;

    const activeResume = resume.getActive(userId);
    if (!activeResume) {
      res.status(400).json({
        error: 'no active master resume — add one at /resume before generating',
      });
      return;
    }

    // Validate the job belongs to this user.
    const jobRow = ctx.db
      .prepare('SELECT id, title, company, description FROM jobs WHERE id = ? AND user_id = ?')
      .get(jobId, userId) as
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

    const app = apps.create(jobId, userId, activeResume.id);

    const bullJob = await generationQueue.add('generate', {
      applicationId: app.id,
      jobId,
      userId,
      adapterName,
    });
    ctx.db
      .prepare('UPDATE applications SET queue_job_id = ? WHERE id = ?')
      .run(bullJob.id ?? null, app.id);

    apps.addEvent(app.id, 'generation.queued', { adapter: adapterName ?? adapter.name });
    bus.publish('application.queued', { applicationId: app.id, jobId });

    ctx.logger.info('applications: queued for generation', {
      appId: app.id,
      jobId,
      queueJobId: bullJob.id,
    });

    res.status(202).json({ application: apps.get(app.id) ?? app });
  });

  // GET /api/applications/queue — live queue counts
  // Must be registered before /:id so 'queue' isn't swallowed by the wildcard.
  router.get('/queue', async (_req, res) => {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      generationQueue.getWaitingCount(),
      generationQueue.getActiveCount(),
      generationQueue.getCompletedCount(),
      generationQueue.getFailedCount(),
      generationQueue.getDelayedCount(),
    ]);
    res.json({
      queued: waiting + delayed,
      active,
      completed,
      failed,
      total: waiting + active + delayed + completed + failed,
    });
  });

  // GET /api/applications/:id — detail
  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const app = apps.get(id);
    if (!app || app.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ application: app });
  });

  // GET /api/applications/:id/cover — serve cover letter file
  router.get('/:id/cover', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const app = apps.get(id);
    if (!app || app.user_id !== req.user!.username) {
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
    if (!app || app.user_id !== req.user!.username) {
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

  // POST /api/applications/:id/regenerate — re-enqueue with optional feedback
  // Allowed from: failed, ready, applied
  router.post('/:id/regenerate', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const app = apps.get(id);
    if (!app || app.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!['failed', 'ready', 'applied'].includes(app.status)) {
      res.status(409).json({
        error: `cannot regenerate — current status is '${app.status}'`,
      });
      return;
    }

    const feedback =
      typeof req.body?.feedback === 'string' && req.body.feedback.trim()
        ? req.body.feedback.trim()
        : undefined;

    apps.updateStatus(id, 'queued');
    ctx.db
      .prepare(`UPDATE applications SET generation_error = NULL, updated_at = datetime('now') WHERE id = ?`)
      .run(id);

    const bullJob = await generationQueue.add('generate', {
      applicationId: id,
      jobId: app.job_id,
      userId: app.user_id,
      feedback,
    });
    ctx.db
      .prepare('UPDATE applications SET queue_job_id = ? WHERE id = ?')
      .run(bullJob.id ?? null, id);

    apps.addEvent(id, 'generation.queued', {
      adapter: adapter.name,
      regenerate: true,
      hasFeedback: feedback !== undefined,
    });
    bus.publish('application.queued', { applicationId: id, jobId: app.job_id });

    res.json({ application: apps.get(id) ?? app });
  });

  // GET /api/applications/:id/versions — list all versions (newest first)
  router.get('/:id/versions', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const app = apps.get(id);
    if (!app || app.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ versions: apps.listVersions(id) });
  });

  // GET /api/applications/:id/versions/:n/cover — cover letter for a specific version
  router.get('/:id/versions/:n/cover', (req, res) => {
    const id = Number(req.params.id);
    const n = Number(req.params.n);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(n) || n <= 0) {
      res.status(400).json({ error: 'invalid id or version number' });
      return;
    }
    const app = apps.get(id);
    if (!app || app.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const version = apps.getVersion(id, n);
    if (!version || !version.cover_letter_path) {
      res.status(404).json({ error: 'version not found or cover letter not available' });
      return;
    }
    const filePath = path.resolve(storageRoot, version.cover_letter_path);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'cover letter file not found on disk' });
      return;
    }
    const slug = app.job_company.replace(/\s+/g, '-').toLowerCase();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cover-letter-${slug}-v${n}.txt"`);
    res.sendFile(filePath);
  });

  // GET /api/applications/:id/versions/:n/resume — tailored resume for a specific version
  router.get('/:id/versions/:n/resume', (req, res) => {
    const id = Number(req.params.id);
    const n = Number(req.params.n);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(n) || n <= 0) {
      res.status(400).json({ error: 'invalid id or version number' });
      return;
    }
    const app = apps.get(id);
    if (!app || app.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const version = apps.getVersion(id, n);
    if (!version || !version.resume_path) {
      res.status(404).json({ error: 'version not found or resume not available' });
      return;
    }
    const filePath = path.resolve(storageRoot, version.resume_path);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'resume file not found on disk' });
      return;
    }
    const slug = app.job_company.replace(/\s+/g, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="resume-${slug}-v${n}.json"`);
    res.sendFile(filePath);
  });

  // POST /api/applications/:id/versions/:n/activate — roll back to a prior version
  router.post('/:id/versions/:n/activate', (req, res) => {
    const id = Number(req.params.id);
    const n = Number(req.params.n);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(n) || n <= 0) {
      res.status(400).json({ error: 'invalid id or version number' });
      return;
    }
    const app = apps.get(id);
    if (!app || app.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const activated = apps.activateVersion(id, n);
    if (!activated) {
      res.status(404).json({ error: 'version not found' });
      return;
    }
    apps.addEvent(id, 'version.activated', { versionNo: n });
    res.json({ version: activated, application: apps.get(id) });
  });

  // POST /api/applications/:id/submit — mark as applied
  router.post('/:id/submit', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const app = apps.get(id);
    if (!app || app.user_id !== req.user!.username) {
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

  // POST /api/applications/:id/pin — exempt from retention sweep
  router.post('/:id/pin', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const app = apps.get(id);
    if (!app || app.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ application: apps.pin(id) ?? app });
  });

  // DELETE /api/applications/:id/pin — remove pin; application is eligible for sweep again
  router.delete('/:id/pin', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const app = apps.get(id);
    if (!app || app.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ application: apps.unpin(id) ?? app });
  });

  // PATCH /api/applications/:id/policy — change retention policy
  router.patch('/:id/policy', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const app = apps.get(id);
    if (!app || app.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const policyName = req.body?.policy;
    if (typeof policyName !== 'string' || !policyName.trim()) {
      res.status(400).json({ error: 'policy name is required' });
      return;
    }
    const policyRow = ctx.db
      .prepare('SELECT ttl_days FROM retention_policies WHERE name = ?')
      .get(policyName.trim()) as { ttl_days: number | null } | undefined;
    if (!policyRow) {
      res.status(400).json({ error: `unknown policy: ${policyName}` });
      return;
    }
    res.json({ application: apps.setPolicy(id, policyName.trim(), policyRow.ttl_days) ?? app });
  });

  // DELETE /api/applications/:id — delete row + clean up generated files
  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const app = apps.get(id);
    if (!app || app.user_id !== req.user!.username) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const appDir = path.resolve(storageRoot, String(id));
    if (fs.existsSync(appDir)) {
      fs.rmSync(appDir, { recursive: true, force: true });
    }

    apps.delete(id);

    // Reset job status back to reviewing if the application workflow had advanced it.
    ctx.db
      .prepare(
        `UPDATE jobs SET status = 'reviewing'
         WHERE id = ? AND status IN ('queued', 'generating', 'ready')`,
      )
      .run(app.job_id);

    res.status(204).end();
  });

  return router;
}
