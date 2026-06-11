import path from 'node:path';
import type { Job, Worker } from 'bullmq';
import type { AppContext } from '../types';
import type { LLMAdapter } from '../../services/llm';
import { buildLLMAdapter } from '../../services/llm';
import { makeWorker } from '../../services/queue';
import { ApplicationsRepo } from './repo';
import { ResumeRepo } from '../resume/repo';
import { generateApplication } from './generator';
import { bus } from '../../services/sse/bus';

export const GENERATION_QUEUE_NAME = 'generation';

export interface GenerationJobData {
  applicationId: number;
  jobId: number;
  userId: string;
  adapterName?: 'anthropic' | 'ollama';
}

export function buildGenerationWorker(
  ctx: AppContext,
  adapter: LLMAdapter,
): Worker<GenerationJobData> {
  const apps = new ApplicationsRepo(ctx.db);
  const resume = new ResumeRepo(ctx.db);
  const storageRoot = path.resolve(ctx.config.storage.root);

  const worker = makeWorker<GenerationJobData, void>(
    GENERATION_QUEUE_NAME,
    async (job: Job<GenerationJobData>) => {
      const { applicationId, jobId, userId, adapterName } = job.data;

      // Per-job adapter: build a fresh one if the enqueue specified a name,
      // otherwise fall back to the module-level default.
      const jobAdapter = adapterName
        ? buildLLMAdapter({ ...ctx.config, llm: { ...ctx.config.llm, default_adapter: adapterName } })
        : adapter;

      apps.updateStatus(applicationId, 'generating');
      bus.publish('application.started', { applicationId, jobId });

      const jobRow = ctx.db
        .prepare('SELECT id, title, company, description FROM jobs WHERE id = ?')
        .get(jobId) as
        | { id: number; title: string; company: string; description: string }
        | undefined;
      if (!jobRow) throw new Error(`Job ${jobId} not found`);
      if (!jobRow.description) throw new Error(`Job ${jobId} has no description`);

      const appRow = apps.get(applicationId);
      if (!appRow) throw new Error(`Application ${applicationId} not found`);

      // Resolve the job's profile (via source_id → sources.profile_id → profiles).
      const profileRow = ctx.db
        .prepare(
          `SELECT p.id, p.resume_version_id FROM profiles p
           JOIN sources s ON s.profile_id = p.id
           JOIN jobs j ON j.source_id = s.id
           WHERE j.id = ?`,
        )
        .get(jobId) as { id: number; resume_version_id: number | null } | undefined;

      // Resume priority: pinned at enqueue (backward compat) → profile version → global active.
      const resumeVersionId =
        appRow.resume_version_id ?? profileRow?.resume_version_id ?? null;
      const resumeRow = resumeVersionId
        ? resume.getById(resumeVersionId)
        : resume.getActive(userId);
      if (!resumeRow) throw new Error('Master resume not found');

      // Writing samples: scoped to profile when available, else all for the user.
      const samples = profileRow
        ? resume.listWritingSamples(userId, profileRow.id)
        : resume.listWritingSamples(userId);

      const output = await generateApplication(
        applicationId,
        jobRow,
        resumeRow,
        samples,
        jobAdapter,
        storageRoot,
      );

      apps.updateGenerated(applicationId, {
        modelUsed: output.modelUsed,
        resumePath: output.resumePath,
        coverPath: output.coverPath,
        diff: output.diff,
        resumeVersionId: resumeRow.id,
      });

      ctx.db
        .prepare(
          `UPDATE jobs SET status = 'ready'
           WHERE id = ? AND status NOT IN ('applied', 'archived', 'dismissed')`,
        )
        .run(jobId);

      apps.addEvent(applicationId, 'generation.completed', {
        model: output.modelUsed,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
      });
      bus.publish('application.ready', { applicationId, jobId });

      ctx.logger.info('applications: generation complete', {
        appId: applicationId,
        jobId,
        model: output.modelUsed,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
      });
    },
    ctx.config,
    { concurrency: ctx.config.queue.concurrency },
  );

  // After all retries are exhausted BullMQ fires this event. We mark the
  // application permanently failed here so intermediate retry attempts don't
  // flip the status prematurely (the processor leaves status = 'generating'
  // between attempts so the UI shows the job is still active).
  worker.on('failed', (job, err) => {
    if (!job) return;
    const { applicationId, jobId } = job.data;
    apps.updateFailed(applicationId, err.message);
    apps.addEvent(applicationId, 'generation.failed', {
      error: err.message,
      attempts: job.attemptsMade,
    });
    bus.publish('application.failed', { applicationId, jobId, error: err.message });
    ctx.logger.warn('applications: generation permanently failed', {
      appId: applicationId,
      jobId,
      error: err.message,
      attempts: job.attemptsMade,
    });
  });

  return worker;
}
