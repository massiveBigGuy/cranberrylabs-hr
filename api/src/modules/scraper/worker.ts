import type { Job, Worker } from 'bullmq';
import type { AppContext } from '../types';
import { makeWorker } from '../../services/queue';
import { ScraperService } from './service';
import type { ScraperAdapter } from './adapters/types';

export const SCRAPE_QUEUE_NAME = 'scrape';

export interface ScrapeJobData {
  source_id: number;
  /** 'listing' is the full paginated scrape. 'probe' is a fast validate-only run. */
  mode: 'listing' | 'probe';
}

export function buildScrapeWorker(
  ctx: AppContext,
  adapters: Record<string, ScraperAdapter>,
): Worker<ScrapeJobData> {
  const service = new ScraperService(ctx, adapters);

  return makeWorker<ScrapeJobData>(
    SCRAPE_QUEUE_NAME,
    async (job: Job<ScrapeJobData>) => {
      const { source_id, mode } = job.data;
      ctx.logger.info('scrape:job:start', { job_id: job.id, source_id, mode });
      if (mode === 'probe') {
        await service.runProbe(source_id);
      } else {
        await service.runScrape(source_id);
      }
      ctx.logger.info('scrape:job:done', { job_id: job.id, source_id, mode });
    },
    ctx.config,
    {
      // Scrapes are I/O-bound and time-consuming. Concurrency of 1 per
      // source is the floor; the global concurrency from config caps the
      // total across all sources. Two parallel scrapes is plenty for now.
      concurrency: ctx.config.queue.concurrency,
    },
  );
}
