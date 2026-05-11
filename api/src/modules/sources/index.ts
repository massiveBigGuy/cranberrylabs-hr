import type { Module, AppContext } from '../types';
import { router } from './router';
import { migrations } from './migrations';

/**
 * The `sources` module — CRUD for company career-page URLs to scrape.
 *
 * This is also the canonical example of the module contract. New modules
 * (scraper, jobs, applications, ...) should copy this file's shape exactly.
 */
export const sourcesModule: Module = {
  name: 'sources',
  version: '0.1.0',
  router,
  migrations,
  workers: [],
  scheduledTasks: [],
  init: async (ctx: AppContext) => {
    ctx.logger.debug('sources module initialized');
    // Future: seed defaults, validate any URLs found in config, etc.
  },
};
