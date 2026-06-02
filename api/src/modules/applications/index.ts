import type { Module, AppContext } from '../types';
import { Router } from 'express';
import { migrations } from './migrations';
import { buildApplicationsRouter } from './router';
import { buildLLMAdapter } from '../../services/llm';
import fs from 'node:fs';
import path from 'node:path';

export const applicationsModule: Module = {
  name: 'applications',
  version: '0.1.0',
  router: Router(),
  migrations,
  workers: [],
  scheduledTasks: [],
  init: async (ctx: AppContext) => {
    // Ensure storage directory exists at startup. storageRoot may be relative
    // to CWD (which in Docker is /app), so resolve it to absolute first.
    const storageRoot = path.resolve(ctx.config.storage.root);
    fs.mkdirSync(storageRoot, { recursive: true });

    // Build the LLM adapter from config. The Anthropic adapter defers API key
    // validation to generate() time — the module initialises cleanly even when
    // ANTHROPIC_API_KEY is not yet set.
    const adapter = buildLLMAdapter(ctx.config);
    ctx.services.register('llm_adapter', adapter);

    applicationsModule.router = buildApplicationsRouter(ctx, adapter);
    ctx.logger.debug('applications module initialized');
  },
};
