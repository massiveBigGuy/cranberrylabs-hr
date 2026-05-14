/**
 * Adapter interface for ATS platforms. Adding a new platform (Greenhouse,
 * Lever, etc.) is a matter of implementing this interface and registering
 * the adapter in adapters/index.ts.
 *
 * Adapters are stateless — they get the source row + filters and return
 * normalized data. The worker handles persistence, dedup, and retry logic.
 */

/**
 * A single normalized job listing from any source. Maps to the `jobs`
 * table columns in §3 of the schema, minus the columns the worker fills
 * itself (id, source_id, discovered_at, status).
 */
export interface NormalizedJob {
  external_id: string;
  title: string;
  company: string;
  location: string | null;
  remote_type: 'remote' | 'hybrid' | 'onsite' | null;
  url: string;
  /** May be empty at listing time; phase-2 detail fetch populates it. */
  description: string;
  /** Hash of `description` for change detection; '' when description is empty. */
  description_hash: string;
  /** ISO date string YYYY-MM-DD if parseable, else null. */
  posted_date: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  /** Platform-specific extras the worker should not interpret. Stored only
   *  for diagnostics during early development; not persisted yet. */
  raw?: Record<string, unknown>;
}

/**
 * A facet discovered on a tenant — used for both probe output and as the
 * input to per-source filter configuration (later UI steps).
 */
export interface DiscoveredFacet {
  /** Stable facet ID from Workday — what gets sent in appliedFacets. */
  id: string;
  /** Human-readable name, e.g. 'Information Technology Group'. */
  descriptor: string;
  /** Workday's facet group, e.g. 'jobFamilyGroup'. */
  parameter: string;
  /** Count of postings under this facet at probe time. */
  count: number;
}

/**
 * Input to a scrape — combines the source row's filter config with any
 * runtime overrides. The adapter consumes this to build its request body.
 *
 * Currently sparse: per-source filters are a future feature, so most fields
 * are reserved. The shape is here so the adapter signature stays stable.
 */
export interface ScrapeFilters {
  /** Stable facet IDs to apply server-side. */
  appliedFacets?: Record<string, string[]>;
  /** Free-text search to send to the platform. */
  searchText?: string;
  /** Global keyword filter from config — applied client-side after fetch. */
  globalExcludeKeywords?: string[];
}

export type ProbeStatus = 'ok' | 'blocked' | 'error';

export interface ProbeResult {
  status: ProbeStatus;
  /** Total job count visible at the endpoint, or null on error. */
  total: number | null;
  facets: DiscoveredFacet[];
  /** Detail of what went wrong; empty when status='ok'. */
  message: string;
  /** HTTP status code from the probe request, if a response was received. */
  httpStatus?: number;
}

export interface ScrapeProgress {
  page: number;
  pages_total: number;
  jobs_seen: number;
}

export interface ScrapeListingResult {
  jobs: NormalizedJob[];
  total: number;
}

export interface DetailFetchResult {
  description: string;
  description_hash: string;
  /** Optional: detail page may reveal salary the listing didn't include. */
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  /** Optional: detail page may reveal a hiring manager name. */
  hiring_manager?: string | null;
}

export interface SourceForScrape {
  id: number;
  company_name: string;
  platform: string;
  tenant_url: string;
  search_params: string | null;
}

export interface ScraperAdapter {
  platform: string;
  /** Lightweight probe — one request, fast. Returns facets for discovery. */
  probe(source: SourceForScrape): Promise<ProbeResult>;
  /** Full listing scrape. Pages through results respecting delays. */
  scrapeListings(
    source: SourceForScrape,
    filters: ScrapeFilters,
    onProgress?: (p: ScrapeProgress) => void,
  ): Promise<ScrapeListingResult>;
  /** Phase-2 fetch: get full description for one job. */
  fetchDetail(source: SourceForScrape, externalUrl: string): Promise<DetailFetchResult>;
}
