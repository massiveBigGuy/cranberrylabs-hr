import type { Queue } from 'bullmq';
import type { Module, AppContext } from '../types';
import { buildSourcesRouter } from './router';
import { migrations } from './migrations';
import type { ScrapeJobData } from '../scraper/worker';

/**
 * Sources module — CRUD for company career-page URLs to scrape, plus the
 * endpoints to trigger probes and full scrapes.
 *
 * The scrape queue is owned by the scraper module. We read it lazily from
 * the service registry so registration order between modules doesn't
 * matter — the queue exists by the time the first HTTP request lands.
 */
export const sourcesModule: Module = {
  name: 'sources',
  version: '0.2.0',
  migrations,
  workers: [],
  scheduledTasks: [],
  init: async (ctx: AppContext) => {
    const getQueue = ctx.services.lazy<Queue<ScrapeJobData>>('scrape_queue');
    sourcesModule.router = buildSourcesRouter(ctx, getQueue);
    ctx.logger.debug('sources module initialized');
  },
};
