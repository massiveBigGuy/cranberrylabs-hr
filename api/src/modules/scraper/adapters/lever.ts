/**
 * Lever adapter — talks to the public JSON postings endpoint Lever
 * maintains and documents for career-site builders.
 *
 * Endpoint shape:
 *   GET https://api.lever.co/v0/postings/{company_slug}?mode=json
 *   (EU tenants: https://api.eu.lever.co/v0/postings/{company_slug}?mode=json)
 *   resp: [ {...}, {...} ]  — a bare array, all published postings
 *
 * One-phase: the listing response already includes the full description.
 * EU vs US host is resolved from `sources.search_params` — see §"Lever EU
 * region" in the adapter build plan: `{ "region": "eu" }`.
 */
import { createLogger } from '../../../services/logger';
import type { AppConfig } from '../../../config';
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

const log = createLogger('adapter:lever');
const REQUEST_TIMEOUT_MS = 15_000;

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt: number;
  description?: string;
  descriptionPlain?: string;
  categories?: {
    location?: string;
    team?: string;
    commitment?: string;
    workplaceType?: string;
  };
  salaryRange?: {
    min?: number;
    max?: number;
    currency?: string;
  };
}

function resolveHost(searchParams: string | null): string {
  if (!searchParams) return 'api.lever.co';
  try {
    const parsed = JSON.parse(searchParams) as { region?: string };
    return parsed.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co';
  } catch {
    return 'api.lever.co';
  }
}

export function createLeverAdapter(config: AppConfig): ScraperAdapter {
  const userAgent = config.scraper.user_agent;

  async function getPostings(
    source: SourceForScrape,
  ): Promise<{ data: unknown; httpStatus: number }> {
    const slug = source.tenant_url.trim();
    const host = resolveHost(source.search_params);
    const url = `https://${host}/v0/postings/${encodeURIComponent(slug)}?mode=json`;
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
          `Lever postings endpoint returned ${httpStatus}: ${errBody.slice(0, 200)}`,
          httpStatus,
        );
      }
      const json = await res.json();
      return { data: json, httpStatus };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    platform: 'lever',

    async probe(source: SourceForScrape): Promise<ProbeResult> {
      try {
        const { data, httpStatus } = await getPostings(source);
        if (!Array.isArray(data)) {
          return {
            status: 'blocked',
            total: null,
            facets: [],
            httpStatus,
            message: 'endpoint returned 200 but response is not a JSON array',
          };
        }
        return { status: 'ok', total: data.length, facets: [], httpStatus, message: '' };
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
      const { data } = await getPostings(source);
      const postings = (Array.isArray(data) ? data : []) as LeverPosting[];

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
      // Defensive re-fetch, same rationale as the Ashby adapter: normal
      // operation never calls this since Lever jobs get a real
      // description_hash at insert time and never enter the sweep.
      const { data } = await getPostings(source);
      const postings = (Array.isArray(data) ? data : []) as LeverPosting[];
      const match = postings.find((p) => p.hostedUrl === externalUrl);
      if (!match) {
        throw new Error(`lever: no posting found matching url ${externalUrl}`);
      }
      const description = extractDescription(match);
      return {
        description,
        description_hash: hashDescription(description),
        salary_min: match.salaryRange?.min ?? null,
        salary_max: match.salaryRange?.max ?? null,
        salary_currency: match.salaryRange?.currency ?? null,
      };
    },
  };
}

function normalizePosting(posting: LeverPosting, source: SourceForScrape): NormalizedJob | null {
  if (!posting.id) {
    log.warn('skipping posting without id', { title: posting.text });
    return null;
  }
  const description = extractDescription(posting);

  return {
    external_id: posting.id,
    title: posting.text?.trim() ?? '(no title)',
    company: source.company_name,
    location: posting.categories?.location?.trim() || null,
    remote_type: mapRemoteType(posting.categories),
    url: posting.hostedUrl,
    description,
    description_hash: hashDescription(description),
    posted_date: parseCreatedAt(posting.createdAt),
    salary_min: posting.salaryRange?.min ?? null,
    salary_max: posting.salaryRange?.max ?? null,
    salary_currency: posting.salaryRange?.currency ?? null,
  };
}

function extractDescription(posting: LeverPosting): string {
  // descriptionPlain is already clean text — preferred over stripping HTML
  // from `description` ourselves.
  return posting.descriptionPlain?.trim() || (posting.description ?? '').replace(/<[^>]+>/g, '').trim();
}

/**
 * docs/update-1.md documents mapping `categories.commitment` to remote_type,
 * but Lever's actual schema carries remote/hybrid/on-site in
 * `categories.workplaceType` (added after that field mapping convention
 * became common); `commitment` is normally an employment type like
 * "Full-time". Prefer workplaceType when present, and fall back to
 * scanning commitment for the word "remote" per the documented mapping so
 * older/atypical tenants that only set commitment still get a result.
 */
function mapRemoteType(
  categories: LeverPosting['categories'],
): 'remote' | 'hybrid' | 'onsite' | null {
  const workplaceType = categories?.workplaceType?.toLowerCase();
  if (workplaceType) {
    if (workplaceType === 'remote') return 'remote';
    if (workplaceType === 'hybrid') return 'hybrid';
    if (workplaceType === 'on-site' || workplaceType === 'onsite') return 'onsite';
  }
  const commitment = categories?.commitment?.toLowerCase() ?? '';
  if (commitment.includes('remote')) return 'remote';
  return null;
}

function parseCreatedAt(ms: number | undefined): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
