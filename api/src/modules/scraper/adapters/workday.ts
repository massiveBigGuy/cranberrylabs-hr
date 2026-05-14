/**
 * Workday adapter — talks to the public JSON endpoint that powers every
 * Workday job site. No headless browser, no HTML scraping.
 *
 * Endpoint shape (per §7 of the schema):
 *   POST {base}/wday/cxs/{tenant}/{site}/jobs
 *   body: { appliedFacets, limit, offset, searchText }
 *   resp: { total, jobPostings: [...], facets: [...], userAuthenticated }
 *
 * Detail endpoint:
 *   GET  {base}/wday/cxs/{tenant}/{site}{externalPath}
 *   resp: { jobPostingInfo: { jobDescription: '<html>...', ... } }
 */
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AppConfig } from '../../../config';
import { createLogger } from '../../../services/logger';
import {
  parseWorkdayUrl,
  buildListingUrl,
  buildDetailUrl,
  type WorkdayUrlParts,
} from '../url-parser';
import type {
  DetailFetchResult,
  DiscoveredFacet,
  NormalizedJob,
  ProbeResult,
  ScrapeFilters,
  ScrapeListingResult,
  ScrapeProgress,
  ScraperAdapter,
  SourceForScrape,
} from './types';

const log = createLogger('adapter:workday');

const PAGE_SIZE = 20;
const MAX_PAGES = 200;        // safety cap; PAGE_SIZE*MAX_PAGES = 4000 jobs/run
const REQUEST_TIMEOUT_MS = 15_000;

// Workday listing response shapes — narrow types for the bits we actually use.
interface WorkdayListingResponse {
  total: number;
  jobPostings: WorkdayPosting[];
  facets?: WorkdayFacetGroup[];
  userAuthenticated?: boolean;
}

interface WorkdayPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  remoteType?: string;
  bulletFields?: string[];
}

interface WorkdayFacetGroup {
  facetParameter: string;
  descriptor?: string;
  values?: WorkdayFacetValue[];
}

interface WorkdayFacetValue {
  id: string;
  descriptor: string;
  count: number;
}

interface WorkdayDetailResponse {
  jobPostingInfo?: {
    jobDescription?: string;
    title?: string;
    location?: string;
    postedOn?: string;
    /** Some tenants populate this; most don't. */
    hiringManager?: string;
  };
}

export function createWorkdayAdapter(config: AppConfig): ScraperAdapter {
  const userAgent = config.scraper.user_agent;
  const requestDelayMs = config.scraper.request_delay_ms;

  /**
   * Single POST to the listing endpoint. Returns parsed JSON or throws.
   * Throws are caught by callers (probe → status='error', scrape → retry).
   */
  async function postListing(
    parts: WorkdayUrlParts,
    body: object,
  ): Promise<{ data: WorkdayListingResponse; httpStatus: number }> {
    const url = buildListingUrl(parts);
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
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const httpStatus = res.status;
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new HttpError(
          `Workday listing endpoint returned ${httpStatus}: ${errBody.slice(0, 200)}`,
          httpStatus,
        );
      }
      const json = (await res.json()) as WorkdayListingResponse;
      return { data: json, httpStatus };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getDetail(parts: WorkdayUrlParts, externalPath: string): Promise<WorkdayDetailResponse> {
    const url = buildDetailUrl(parts, externalPath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': userAgent,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new HttpError(`detail ${res.status} for ${url}`, res.status);
      }
      return (await res.json()) as WorkdayDetailResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    platform: 'workday',

    async probe(source: SourceForScrape): Promise<ProbeResult> {
      const parsed = parseWorkdayUrl(source.tenant_url);
      if (!parsed.ok) {
        return { status: 'error', total: null, facets: [], message: parsed.error! };
      }
      try {
        const { data, httpStatus } = await postListing(parsed.parts!, {
          appliedFacets: {},
          limit: 1,
          offset: 0,
          searchText: '',
        });

        // Shape check — Workday's response should always have these two
        // fields. If it doesn't, the endpoint exists but is returning
        // something unexpected (API drift, wrong site name returning a
        // different surface, etc.).
        const hasJobs = Array.isArray(data.jobPostings);
        const hasTotal = typeof data.total === 'number';
        if (!hasJobs || !hasTotal) {
          return {
            status: 'blocked',
            total: null,
            facets: [],
            httpStatus,
            message: `endpoint returned 200 but response shape is unexpected (missing ${
              !hasJobs ? 'jobPostings' : 'total'
            })`,
          };
        }

        return {
          status: 'ok',
          total: data.total,
          facets: flattenFacets(data.facets ?? []),
          httpStatus,
          message: '',
        };
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
      filters: ScrapeFilters,
      onProgress?: (p: ScrapeProgress) => void,
    ): Promise<ScrapeListingResult> {
      const parsed = parseWorkdayUrl(source.tenant_url);
      if (!parsed.ok) {
        throw new Error(`cannot scrape: ${parsed.error}`);
      }
      const parts = parsed.parts!;

      const baseBody = {
        appliedFacets: filters.appliedFacets ?? {},
        searchText: filters.searchText ?? '',
        limit: PAGE_SIZE,
      };

      const collected: NormalizedJob[] = [];
      let offset = 0;
      let total = 0;

      for (let page = 0; page < MAX_PAGES; page++) {
        const { data } = await postListing(parts, { ...baseBody, offset });

        if (page === 0) {
          total = data.total;
          log.info('scrape:list:start', {
            source_id: source.id,
            company: source.company_name,
            total,
          });
        }

        if (!data.jobPostings || data.jobPostings.length === 0) {
          break;
        }

        for (const posting of data.jobPostings) {
          const normalized = normalizePosting(posting, source, parts);
          if (normalized) collected.push(normalized);
        }

        onProgress?.({
          page: page + 1,
          pages_total: Math.ceil(total / PAGE_SIZE),
          jobs_seen: collected.length,
        });

        offset += PAGE_SIZE;
        if (offset >= total) break;

        // Be polite — pause between page requests.
        if (requestDelayMs > 0) {
          await sleep(requestDelayMs);
        }
      }

      return { jobs: collected, total };
    },

    async fetchDetail(source: SourceForScrape, externalUrl: string): Promise<DetailFetchResult> {
      const parsed = parseWorkdayUrl(source.tenant_url);
      if (!parsed.ok) throw new Error(`cannot fetch detail: ${parsed.error}`);

      // externalUrl is the full URL we stored in jobs.url. Strip back to the
      // /job/... path that Workday's detail endpoint expects.
      const u = new URL(externalUrl);
      const segments = u.pathname.split('/');
      const jobIdx = segments.indexOf('job');
      const externalPath = jobIdx >= 0 ? '/' + segments.slice(jobIdx).join('/') : u.pathname;

      const detail = await getDetail(parsed.parts!, externalPath);
      const html = detail.jobPostingInfo?.jobDescription ?? '';
      const description = htmlToText(html);
      const description_hash = description
        ? crypto.createHash('sha256').update(description).digest('hex')
        : '';

      return {
        description,
        description_hash,
        hiring_manager: detail.jobPostingInfo?.hiringManager ?? null,
      };
    },
  };
}

/**
 * Convert a Workday posting into our normalized shape. Returns null if a
 * posting can't be normalized (missing required fields) — we drop it rather
 * than crash the whole scrape.
 */
function normalizePosting(
  posting: WorkdayPosting,
  source: SourceForScrape,
  parts: WorkdayUrlParts,
): NormalizedJob | null {
  // bulletFields[0] is the platform job ID, e.g. 'JR-202610113'. Without
  // it we can't dedup, so we have to skip.
  const externalId = posting.bulletFields?.[0]?.trim();
  if (!externalId) {
    log.warn('skipping posting without external_id', { title: posting.title });
    return null;
  }

  return {
    external_id: externalId,
    title: posting.title?.trim() ?? '(no title)',
    company: source.company_name,
    location: posting.locationsText?.trim() || null,
    remote_type: mapRemoteType(posting.remoteType),
    url: buildPublicJobUrl(parts, posting.externalPath),
    description: '',           // phase 2 fills this
    description_hash: '',
    posted_date: parsePostedOn(posting.postedOn ?? null),
    salary_min: null,
    salary_max: null,
    salary_currency: null,
  };
}

/**
 * Build the *public* job URL — what we store and what the user opens in a
 * browser. Distinct from the API detail URL (which lives under /wday/cxs/...).
 *
 *   buildPublicJobUrl(parts, '/job/Toluca-Mexico-Mexico/Becario-..._JR-202610113')
 *     → 'https://generalmotors.wd5.myworkdayjobs.com/Careers_GM/job/Toluca-Mexico-Mexico/Becario-..._JR-202610113'
 */
function buildPublicJobUrl(parts: WorkdayUrlParts, externalPath: string): string {
  const path = externalPath.startsWith('/') ? externalPath : `/${externalPath}`;
  return `${parts.base}/${parts.site}${path}`;
}

/**
 * Normalize Workday's remote-type strings. They use 'Onsite', 'Hybrid',
 * 'Remote', 'Remote/Hybrid'. We collapse the slash variant to 'hybrid'
 * since the difference doesn't matter for filtering.
 */
function mapRemoteType(s: string | undefined): 'remote' | 'hybrid' | 'onsite' | null {
  if (!s) return null;
  const k = s.toLowerCase();
  if (k === 'remote') return 'remote';
  if (k === 'onsite') return 'onsite';
  if (k.includes('hybrid')) return 'hybrid';
  return null;
}

/**
 * Parse Workday's relative 'postedOn' strings into ISO dates.
 *
 *   'Posted Today'         → today
 *   'Posted Yesterday'     → today - 1
 *   'Posted N Days Ago'    → today - N
 *   'Posted 30+ Days Ago'  → today - 30
 *   anything else          → null
 *
 * We use UTC date math. The "today" anchor is the scrape time — close enough
 * for filtering since postedOn has day-level resolution anyway.
 */
function parsePostedOn(s: string | null): string | null {
  if (!s) return null;
  const trimmed = s.trim().toLowerCase();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (trimmed === 'posted today') {
    return today.toISOString().slice(0, 10);
  }
  if (trimmed === 'posted yesterday') {
    today.setUTCDate(today.getUTCDate() - 1);
    return today.toISOString().slice(0, 10);
  }
  const m = /^posted\s+(\d+)\+?\s+days?\s+ago/.exec(trimmed);
  if (m) {
    today.setUTCDate(today.getUTCDate() - Number(m[1]));
    return today.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Flatten Workday's nested facet structure into a flat list. They sometimes
 * nest facets one level deep (e.g. locationMainGroup → locations); we
 * normalize that out so the consumer doesn't care about nesting.
 */
function flattenFacets(groups: WorkdayFacetGroup[]): DiscoveredFacet[] {
  const out: DiscoveredFacet[] = [];
  for (const group of groups) {
    if (!group.values) continue;
    for (const v of group.values) {
      // Some entries are themselves nested groups — values without id but
      // with another values[]. We unwrap one level.
      const nested = v as unknown as WorkdayFacetGroup;
      if (!v.id && Array.isArray(nested.values)) {
        for (const inner of nested.values) {
          out.push({
            id: inner.id,
            descriptor: inner.descriptor,
            parameter: nested.facetParameter ?? group.facetParameter,
            count: inner.count,
          });
        }
        continue;
      }
      out.push({
        id: v.id,
        descriptor: v.descriptor,
        parameter: group.facetParameter,
        count: v.count,
      });
    }
  }
  return out;
}

/**
 * Minimal HTML → plain text converter. Good enough for Workday job
 * descriptions, which use a small subset of HTML (p, ul, li, br, strong,
 * em, a). We don't pull in cheerio for this — it's 200KB and we'd use 5%
 * of it.
 *
 * Caveats: not safe against arbitrary HTML, doesn't preserve list structure
 * perfectly, doesn't handle &nbsp; specially. Acceptable for our use case
 * since the LLM gets the text and will tolerate light noise.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    // line-break tags → newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    // bullet markers
    .replace(/<li[^>]*>/gi, '• ')
    // strip all remaining tags
    .replace(/<[^>]+>/g, '')
    // basic entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // collapse whitespace runs but preserve paragraph breaks
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

class HttpError extends Error {
  constructor(message: string, public httpStatus: number) {
    super(message);
    this.name = 'HttpError';
  }
}
