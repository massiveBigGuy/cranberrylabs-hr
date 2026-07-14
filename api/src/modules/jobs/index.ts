import type { Module, AppContext } from '../types';
import { Router } from 'express';
import { migrations } from './migrations';
import { buildJobsRouter } from './router';
import { JobsRepo } from './repo';
import { computeFitScore } from './fit-scorer';
import { parseLocation } from '../scraper/location-parser';

/**
 * The `jobs` module — read/filter/tag/dismiss jobs that the scraper has
 * discovered. The jobs table itself is owned by the scraper module (step 2);
 * this module adds the higher-level operations and the tag tables.
 *
 * Lazy-router pattern, matching the scraper module from step 2: the
 * router is built inside `init` once we have an AppContext, then assigned
 * to `module.router`. The loader runs `init` before mounting (see the
 * loop in modules/loader.ts), so when `app.use('/api/jobs', mod.router)`
 * fires, the real router is in place.
 */
export const jobsModule: Module = {
  name: 'jobs',
  version: '0.1.0',
  router: Router(),
  // ^ placeholder, replaced in init. The Router() here exists only to
  //   satisfy the Module type's `router: Router` requirement at module
  //   definition time. It's never actually mounted.
  migrations,
  workers: [],
  scheduledTasks: [],
  init: async (ctx: AppContext) => {
    jobsModule.router = buildJobsRouter(ctx);

    // Backfill fit scores for any jobs that have a description but no score yet.
    // Pure string-matching on ~843 rows takes < 5ms — fast enough to run inline.
    const repo = new JobsRepo(ctx.db);
    const unscored = repo.findNeedingFitScore();
    if (unscored.length > 0) {
      const signals = ctx.config.scraper?.filters?.target_keywords ?? [];
      const excludes = ctx.config.scraper?.filters?.excluded_keywords ?? [];
      ctx.logger.info('fit backfill: starting', { count: unscored.length });
      for (const job of unscored) {
        const result = computeFitScore(job, signals, excludes);
        repo.updateFitScore(job.id, result.score, JSON.stringify(result.reasons));
      }
      ctx.logger.info('fit backfill: complete', { scored: unscored.length });
    }

    // Backfill location_country/state/city for jobs whose location was
    // never parsed (new column added in scraper_005_location_parsed).
    // Remote jobs are correctly excluded — see findNeedingLocationParse.
    const needingLocation = repo.findNeedingLocationParse();
    if (needingLocation.length > 0) {
      ctx.logger.info('location backfill: starting', { count: needingLocation.length });
      for (const job of needingLocation) {
        const parsed = parseLocation(job.location, job.remote_type);
        repo.updateLocation(job.id, parsed.country, parsed.state, parsed.city);
      }
      ctx.logger.info('location backfill: complete', { parsed: needingLocation.length });
    }

    ctx.logger.debug('jobs module initialized');
  },
};
