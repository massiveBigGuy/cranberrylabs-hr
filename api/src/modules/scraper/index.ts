import type { Module, AppContext, WorkerRegistration } from '../types';
import { migrations } from './migrations';
import { buildScraperRouter } from './router';
import { buildAdapters } from './adapters';
import { buildScrapeWorker, SCRAPE_QUEUE_NAME, type ScrapeJobData } from './worker';
import { makeQueue } from '../../services/queue';
import { runDetailSweep } from './detail-sweep';

/**
 * Adapters are shared between the listing worker (per scrape job) and the
 * detail-fetch cron sweep. They're stateless, so we build the registry
 * once during init and reuse.
 */
let adapters: ReturnType<typeof buildAdapters> | null = null;

/**
 * The Module contract requires `router`, `workers`, and `scheduledTasks`
 * to exist before the loader reads them. The loader's order is:
 *   migrations → init → read workers/cron → mount router
 *
 * So `init` is the right place to *populate* these fields when their
 * construction depends on ctx (db, config, registered services). We start
 * with placeholder values and replace/extend them inside init.
 *
 * If this pattern proves too fragile in step 3, we'll change the Module
 * contract so init can *return* workers and cron tasks instead of
 * mutating the module object.
 */
export const scraperModule: Module = {
  name: 'scraper',
  version: '0.1.0',
  // router is assigned inside init once ctx is available.
  migrations,
  workers: [],
  scheduledTasks: [],
  init: async (ctx: AppContext) => {
    adapters = buildAdapters(ctx.config);

    // Build the scrape queue and register it so the sources router can
    // reach it. Lazy lookup (via services.lazy) means initialization order
    // between modules doesn't matter — sources init runs before scraper,
    // but its router only resolves the queue when a request comes in.
    const queue = makeQueue<ScrapeJobData>(SCRAPE_QUEUE_NAME, ctx.config);
    ctx.services.register('scrape_queue', queue);

    // Build the router now that ctx is available.
    scraperModule.router = buildScraperRouter(ctx);

    // Worker registration. Adapters are captured by closure here, not
    // re-resolved per job — they're stateless and cheap to keep around.
    const reg: WorkerRegistration = {
      queueName: SCRAPE_QUEUE_NAME,
      build: (c) => buildScrapeWorker(c, adapters!),
    };
    scraperModule.workers!.push(reg);

    // Hourly detail-fetch sweep. Offset from on-the-hour to keep the log
    // noise distinct from any other cron task users add later.
    scraperModule.scheduledTasks!.push({
      name: 'scraper:detail-sweep',
      cron: '5 * * * *',
      task: async (c) => {
        await runDetailSweep(c, adapters!);
      },
    });
  },
};
