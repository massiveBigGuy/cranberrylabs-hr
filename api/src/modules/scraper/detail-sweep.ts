import { setTimeout as sleep } from 'node:timers/promises';
import type { AppContext } from '../types';
import type { ScraperAdapter } from './adapters/types';
import { getAdapter } from './adapters';
import { SourcesRepo } from '../sources/repo';
import { JobsRepo } from './repo-jobs';
import { bus } from '../../services/sse/bus';
import { computeFitScore } from '../jobs/fit-scorer';

/**
 * Phase-2 sweep: walk jobs that have no description yet and fetch each one's
 * detail. Runs hourly via cron (see module registration).
 *
 * Design:
 *   - Caps the per-run job count so a backlog doesn't monopolize the cron
 *     window. Anything not handled this hour gets picked up next hour.
 *   - Sleeps `request_delay_ms` between detail fetches — same politeness
 *     as the listing scrape uses for paging.
 *   - On per-job failure, logs and continues. One broken posting must not
 *     stall the entire sweep.
 *   - Skips disabled sources entirely — same gate as the scrape itself.
 *
 * Tuning notes: with the default request_delay_ms=2000 and PER_RUN_JOB_CAP=300,
 * a sweep takes up to 10 minutes (300 × 2s). Comfortably under one hour.
 * For a fresh source with ~1000 unfetched jobs, the backlog drains in
 * roughly 4 hours. Bump the cap or the cron frequency if that's too slow.
 */
const PER_RUN_JOB_CAP = 300;
const MAX_DETAIL_FETCH_ATTEMPTS = 5;

export async function runDetailSweep(
  ctx: AppContext,
  adapters: Record<string, ScraperAdapter>,
): Promise<void> {
  const sources = new SourcesRepo(ctx.db);
  const jobs = new JobsRepo(ctx.db);
  const requestDelayMs = ctx.config.scraper.request_delay_ms;

  const candidates = jobs.findMissingDescriptions(PER_RUN_JOB_CAP, MAX_DETAIL_FETCH_ATTEMPTS);
  if (candidates.length === 0) {
    ctx.logger.debug('detail sweep: nothing to do');
    return;
  }

  ctx.logger.info('detail sweep: starting', { count: candidates.length });

  // Group by source so we can dispatch to the right adapter and skip
  // disabled sources without re-checking on each job.
  const bySource = new Map<number, typeof candidates>();
  for (const job of candidates) {
    const arr = bySource.get(job.source_id) ?? [];
    arr.push(job);
    bySource.set(job.source_id, arr);
  }

  let processed = 0;
  let failed = 0;

  for (const [sourceId, sourceJobs] of bySource) {
    const source = sources.get(sourceId);
    if (!source || source.enabled === 0) {
      ctx.logger.debug('detail sweep: skipping disabled/missing source', { sourceId });
      continue;
    }

    let adapter: ScraperAdapter;
    try {
      adapter = getAdapter(adapters, source.platform);
    } catch (err) {
      ctx.logger.warn('detail sweep: no adapter', {
        sourceId,
        platform: source.platform,
        error: (err as Error).message,
      });
      continue;
    }

    for (const job of sourceJobs) {
      try {
        const detail = await adapter.fetchDetail(
          {
            id: source.id,
            company_name: source.company_name,
            platform: source.platform,
            tenant_url: source.tenant_url,
            search_params: source.search_params,
          },
          job.url,
        );
        jobs.updateDescription(
          job.id,
          detail.description,
          detail.description_hash,
          detail.hiring_manager ?? null,
        );
        const signals = ctx.config.scraper?.filters?.target_keywords ?? [];
        const excludes = ctx.config.scraper?.filters?.excluded_keywords ?? [];
        const fit = computeFitScore(
          { title: job.title, description: detail.description },
          signals,
          excludes,
        );
        jobs.updateFitScore(job.id, fit.score, JSON.stringify(fit.reasons));
        bus.publish('job.discovered', {
          phase: 'detail',
          job_id: job.id,
          source_id: sourceId,
          title: job.title,
        });
        processed++;
      } catch (err) {
        failed++;
        const message = (err as Error).message;
        const result = jobs.recordDetailFetchFailure(job.id, MAX_DETAIL_FETCH_ATTEMPTS);

        if (result.gaveUp) {
          ctx.logger.warn('detail fetch: giving up after max attempts', {
            job_id: job.id,
            attempts: result.attempts,
            url: job.url,
            last_error: message,
          });
        } else {
          ctx.logger.warn('detail fetch failed', {
            job_id: job.id,
            attempt: result.attempts,
            url: job.url,
            error: message,
          });
        }
      }
      if (requestDelayMs > 0) await sleep(requestDelayMs);
    }
  }

  ctx.logger.info('detail sweep: complete', { processed, failed });
}
