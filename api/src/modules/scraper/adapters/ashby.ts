/**
 * Ashby adapter — talks to the public JSON job-board endpoint that powers
 * every hosted `jobs.ashby.io/{slug}` career page. Undocumented but stable
 * (per docs/update-1.md); same endpoint the hosted page itself calls.
 *
 * Endpoint shape:
 *   POST https://api.ashbyhq.com/posting-api/job-board/{company_slug}
 *   body: {}
 *   resp: { jobs: [...] }
 *
 * One-phase: the listing response already includes the full description,
 * so there is no separate detail endpoint. `fetchDetail` re-fetches the
 * listing defensively (see comment below) rather than assuming it's never
 * called.
 */
import type { AppConfig } from '../../../config';
import { createLogger } from '../../../services/logger';
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

const log = createLogger('adapter:ashby');
const REQUEST_TIMEOUT_MS = 15_000;

interface AshbyListingResponse {
  jobs?: AshbyPosting[];
}

interface AshbyPosting {
  id: string;
  title: string;
  location?: string;
  employmentType?: string;
  isRemote?: boolean;
  publishedDate?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  applyUrl: string;
  compensation?: {
    min?: number;
    max?: number;
    currency?: string;
  };
}

export function createAshbyAdapter(config: AppConfig): ScraperAdapter {
  const userAgent = config.scraper.user_agent;

  async function postJobBoard(
    slug: string,
  ): Promise<{ data: AshbyListingResponse; httpStatus: number }> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': userAgent,
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      const httpStatus = res.status;
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new HttpError(
          `Ashby job board endpoint returned ${httpStatus}: ${errBody.slice(0, 200)}`,
          httpStatus,
        );
      }
      const json = (await res.json()) as AshbyListingResponse;
      return { data: json, httpStatus };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    platform: 'ashby',

    async probe(source: SourceForScrape): Promise<ProbeResult> {
      const slug = source.tenant_url.trim();
      try {
        const { data, httpStatus } = await postJobBoard(slug);
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
      const slug = source.tenant_url.trim();
      const { data } = await postJobBoard(slug);
      const postings = data.jobs ?? [];

      log.info('scrape:list:start', { source_id: source.id, company: source.company_name, total: postings.length });

      const collected = postings
        .map((p) => normalizePosting(p, source))
        .filter((j): j is NormalizedJob => j !== null);

      onProgress?.({ page: 1, pages_total: 1, jobs_seen: collected.length });

      return { jobs: collected, total: postings.length };
    },

    async fetchDetail(source: SourceForScrape, externalUrl: string): Promise<DetailFetchResult> {
      // Defensive re-fetch: in normal operation this is never invoked, since
      // every Ashby job gets a real description_hash at insert time and
      // never has an empty description for the sweep's candidate query to
      // pick up. Implemented for real (rather than throwing) in case a
      // description ever needs re-derivation later.
      const slug = source.tenant_url.trim();
      const { data } = await postJobBoard(slug);
      const match = (data.jobs ?? []).find((p) => p.applyUrl === externalUrl);
      if (!match) {
        throw new Error(`ashby: no posting found matching url ${externalUrl}`);
      }
      const description = match.descriptionPlain?.trim() || htmlToText(match.descriptionHtml ?? '');
      return {
        description,
        description_hash: hashDescription(description),
        salary_min: match.compensation?.min ?? null,
        salary_max: match.compensation?.max ?? null,
        salary_currency: match.compensation?.currency ?? null,
      };
    },
  };
}

function normalizePosting(posting: AshbyPosting, source: SourceForScrape): NormalizedJob | null {
  if (!posting.id) {
    log.warn('skipping posting without id', { title: posting.title });
    return null;
  }
  const description =
    posting.descriptionPlain?.trim() || htmlToText(posting.descriptionHtml ?? '');

  return {
    external_id: posting.id,
    title: posting.title?.trim() ?? '(no title)',
    company: source.company_name,
    location: posting.location?.trim() || null,
    remote_type: posting.isRemote ? 'remote' : null,
    url: posting.applyUrl,
    description,
    description_hash: hashDescription(description),
    posted_date: parsePublishedDate(posting.publishedDate ?? null),
    salary_min: posting.compensation?.min ?? null,
    salary_max: posting.compensation?.max ?? null,
    salary_currency: posting.compensation?.currency ?? null,
  };
}

function parsePublishedDate(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
