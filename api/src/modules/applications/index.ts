import type { Module, AppContext, WorkerRegistration } from '../types';
import { Router } from 'express';
import { migrations } from './migrations';
import { buildApplicationsRouter } from './router';
import { buildGenerationWorker, GENERATION_QUEUE_NAME, type GenerationJobData } from './worker';
import { buildLLMAdapter } from '../../services/llm';
import { makeQueue } from '../../services/queue';
import fs from 'node:fs';
import path from 'node:path';

export const applicationsModule: Module = {
  name: 'applications',
  version: '0.2.0',
  router: Router(),
  migrations,
  workers: [],
  scheduledTasks: [],
  init: async (ctx: AppContext) => {
    const storageRoot = path.resolve(ctx.config.storage.root);
    fs.mkdirSync(storageRoot, { recursive: true });

    const adapter = buildLLMAdapter(ctx.config);
    ctx.services.register('llm_adapter', adapter);

    // Generation queue — 3 attempts (2 retries) so transient LLM errors
    // (missing XML sections, empty responses) get a second chance before
    // the application is marked permanently failed.
    const generationQueue = makeQueue<GenerationJobData>(GENERATION_QUEUE_NAME, ctx.config, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      },
    });
    ctx.services.register('generation_queue', generationQueue);

    applicationsModule.router = buildApplicationsRouter(ctx, adapter, generationQueue);

    const reg: WorkerRegistration = {
      queueName: GENERATION_QUEUE_NAME,
      build: (c) => buildGenerationWorker(c, adapter),
    };
    applicationsModule.workers!.push(reg);

    ctx.logger.debug('applications module initialized');
  },
};
