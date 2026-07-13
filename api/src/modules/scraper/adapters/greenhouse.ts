/**
 * Greenhouse adapter — talks to the public Boards API, the same endpoint
 * every embedded Greenhouse career-page widget calls. Officially
 * documented for custom career site builders.
 *
 * Listing endpoint (abbreviated records, no description):
 *   GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs
 *   resp: { jobs: [...] }
 *
 * Detail endpoint (per job, full description):
 *   GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{job_id}
 *   resp: { id, title, content: '<html>...', departments, offices, ... }
 *
 * Two-phase, like Workday: listing rows are inserted with an empty
 * description and description_hash; the hourly detail sweep
 * (detail-sweep.ts) fills them in and runs the existing cross-source
 * dedup check unchanged.
 */
import { createLogger } from '../../../services/logger';
import type { AppConfig } from '../../../config';
import { htmlToText } from './workday';
import { hashDescription, HttpError } from './util';
import type {
  DetailFetchResult,
  NormalizedJob,
  ProbeResult,
  ScrapeFilters,
  ScrapeListingResult,
  ScrapeProgress,
  ScraperAdapter,
  SourceForScrape,
} from './types';

const log = createLogger('adapter:greenhouse');
const REQUEST_TIMEOUT_MS = 15_000;

interface GreenhouseListingResponse {
  jobs?: GreenhouseListingPosting[];
}

interface GreenhouseListingPosting {
  id: number;
  title: string;
  location?: { name?: string };
  absolute_url: string;
  updated_at?: string;
}

interface GreenhouseDetailResponse {
  content?: string;
}

export function createGreenhouseAdapter(config: AppConfig): ScraperAdapter {
  const userAgent = config.scraper.user_agent;

  async function getJson<T>(url: string): Promise<{ data: T; httpStatus: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': userAgent },
        signal: controller.signal,
      });
      const httpStatus = res.status;
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new HttpError(
          `Greenhouse endpoint returned ${httpStatus}: ${errBody.slice(0, 200)}`,
          httpStatus,
        );
      }
      const json = (await res.json()) as T;
      return { data: json, httpStatus };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    platform: 'greenhouse',

    async probe(source: SourceForScrape): Promise<ProbeResult> {
      const token = source.tenant_url.trim();
      try {
        const { data, httpStatus } = await getJson<GreenhouseListingResponse>(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`,
        );
        if (!Array.isArray(data.jobs)) {
          return {
            status: 'blocked',
            total: null,
            facets: [],
            httpStatus,
            message: 'endpoint returned 200 but response is missing a jobs array',
          };
        }
        return { status: 'ok', total: data.jobs.length, facets: [], httpStatus, message: '' };
      } catch (err) {
        const httpStatus = err instanceof HttpError ? err.httpStatus : undefined;
        return {
          status: 'error',
          total: null,
          facets: [],
          httpStatus,
          message: (err as Error).message,
        };
      }
    },

    async scrapeListings(
      source: SourceForScrape,
      _filters: ScrapeFilters,
      onProgress?: (p: ScrapeProgress) => void,
    ): Promise<ScrapeListingResult> {
      const token = source.tenant_url.trim();
      const { data } = await getJson<GreenhouseListingResponse>(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`,
      );
      const postings = data.jobs ?? [];

      log.info('scrape:list:start', {
        source_id: source.id,
        company: source.company_name,
        total: postings.length,
      });

      const collected = postings
        .map((p) => normalizePosting(p, source))
        .filter((j): j is NormalizedJob => j !== null);

      onProgress?.({ page: 1, pages_total: 1, jobs_seen: collected.length });

      return { jobs: collected, total: postings.length };
    },

    async fetchDetail(source: SourceForScrape, externalUrl: string): Promise<DetailFetchResult> {
      const token = source.tenant_url.trim();
      const jobId = extractJobId(externalUrl);
      if (!jobId) {
        throw new Error(`greenhouse: could not extract a job id from url ${externalUrl}`);
      }
      const { data } = await getJson<GreenhouseDetailResponse>(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${jobId}`,
      );
      const description = htmlToText(data.content ?? '');
      return {
        description,
        description_hash: hashDescription(description),
      };
    },
  };
}

function normalizePosting(
  posting: GreenhouseListingPosting,
  source: SourceForScrape,
): NormalizedJob | null {
  if (posting.id == null) {
    log.warn('skipping posting without id', { title: posting.title });
    return null;
  }
  return {
    external_id: String(posting.id),
    title: posting.title?.trim() ?? '(no title)',
    company: source.company_name,
    location: posting.location?.name?.trim() || null,
    remote_type: null,
    url: posting.absolute_url,
    description: '', // phase 2 fills this
    description_hash: '',
    posted_date: parseUpdatedAt(posting.updated_at ?? null),
    salary_min: null,
    salary_max: null,
    salary_currency: null,
  };
}

/**
 * Known correctness point: the ScraperAdapter interface only passes the
 * stored public URL to fetchDetail, not the job's external_id, so the
 * numeric Greenhouse job id has to be recovered from the URL itself.
 * `absolute_url` always ends in `/jobs/{id}` (true for both
 * boards.greenhouse.io/{token} and custom career-site domains), so the
 * trailing numeric path segment is the id — treat it verbatim, don't
 * special-case the host.
 */
function extractJobId(url: string): string | null {
  const m = /\/(\d+)\/?(?:[?#].*)?$/.exec(url);
  return m ? m[1]! : null;
}

function parseUpdatedAt(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
