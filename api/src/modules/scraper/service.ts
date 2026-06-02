import type { AppContext } from '../types';
import { bus } from '../../services/sse/bus';
import type { ScraperAdapter, ScrapeFilters } from './adapters/types';
import { getAdapter } from './adapters';
import { SourcesRepo } from '../sources/repo';
import { JobsRepo } from './repo-jobs';
import { ScrapeRunsRepo } from './repo-runs';

/**
 * Service layer for the scraper. Routes call into here so the actual
 * business logic stays adapter-agnostic and easy to test.
 *
 * Two entry points:
 *   - runProbe   — fast, validates a source, updates last_status/last_error
 *   - runScrape  — full listing scrape, persists jobs, writes scrape_run
 *
 * Phase-2 detail fetching lives in `detail-sweep.ts` — invoked by cron, not
 * tied to a single source.
 */
export class ScraperService {
  constructor(
    private readonly ctx: AppContext,
    private readonly adapters: Record<string, ScraperAdapter>,
    private readonly sources = new SourcesRepo(ctx.db),
    private readonly jobs = new JobsRepo(ctx.db),
    private readonly runs = new ScrapeRunsRepo(ctx.db),
  ) {}

  async runProbe(sourceId: number): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`source ${sourceId} not found`);
    const adapter = getAdapter(this.adapters, source.platform);

    const result = await adapter.probe({
      id: source.id,
      company_name: source.company_name,
      platform: source.platform,
      tenant_url: source.tenant_url,
      search_params: source.search_params,
    });

    this.sources.recordProbeResult(sourceId, {
      last_status: result.status,
      last_error: result.message || null,
    });

    bus.publish('scrape.started', {
      // Reusing scrape.started so the UI's status indicators don't need a
      // separate event type for probes. The payload's `phase: 'probe'`
      // disambiguates.
      phase: 'probe',
      source_id: sourceId,
      status: result.status,
      total: result.total,
    });
  }

  async runScrape(sourceId: number): Promise<{ found: number; new: number }> {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`source ${sourceId} not found`);
    const adapter = getAdapter(this.adapters, source.platform);

    const run = this.runs.start(sourceId);
    bus.publish('scrape.started', {
      phase: 'listing',
      source_id: sourceId,
      run_id: run.id,
      company: source.company_name,
    });

    try {
      // Build filters. Today this only carries the global exclude list from
      // config — per-source filters slot in here later by reading
      // source.search_params.
      const filters: ScrapeFilters = {
        globalExcludeKeywords: this.ctx.config.scraper.filters.excluded_keywords,
      };

      const { jobs, total } = await adapter.scrapeListings(
        {
          id: source.id,
          company_name: source.company_name,
          platform: source.platform,
          tenant_url: source.tenant_url,
          search_params: source.search_params,
        },
        filters,
        (p) => {
          bus.publish('queue.progress', {
            scope: 'scrape',
            source_id: sourceId,
            page: p.page,
            pages_total: p.pages_total,
            jobs_seen: p.jobs_seen,
          });
        },
      );

      // Apply global client-side filters. Per-source filters happen here
      // too once we have them.
      const filtered = applyGlobalFilters(jobs, filters);

      const { inserted, existed } = this.jobs.upsertMany(sourceId, source.user_id, filtered);
      this.runs.finishOk(run.id, filtered.length, inserted);
      this.sources.recordProbeResult(sourceId, {
        last_status: 'ok',
        last_error: null,
        last_scraped_at: new Date().toISOString(),
      });

      this.ctx.logger.info('scrape complete', {
        source_id: sourceId,
        total_at_source: total,
        kept: filtered.length,
        new: inserted,
        existing: existed,
      });

      bus.publish('scrape.completed', {
        source_id: sourceId,
        run_id: run.id,
        company: source.company_name,
        jobs_found: filtered.length,
        jobs_new: inserted,
      });

      return { found: filtered.length, new: inserted };
    } catch (err) {
      const message = (err as Error).message ?? 'unknown error';
      this.runs.finishError(run.id, message);
      this.sources.recordProbeResult(sourceId, {
        last_status: 'error',
        last_error: message,
      });
      bus.publish('scrape.completed', {
        source_id: sourceId,
        run_id: run.id,
        company: source.company_name,
        error: message,
      });
      throw err;
    }
  }
}

/**
 * Drop jobs that match any global exclude keyword. Case-insensitive substring
 * match against title — the cheapest useful filter, runs before storage so
 * we don't waste rows on obvious-no postings.
 *
 * Per-source filters will compose here later: same function signature, just
 * with additional rules passed in via ScrapeFilters.
 */
function applyGlobalFilters<T extends { title: string }>(
  jobs: T[],
  filters: ScrapeFilters,
): T[] {
  const excludes = (filters.globalExcludeKeywords ?? []).map((k) => k.toLowerCase());
  if (excludes.length === 0) return jobs;
  return jobs.filter((j) => {
    const title = j.title.toLowerCase();
    return !excludes.some((k) => title.includes(k));
  });
}
