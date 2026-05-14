/**
 * Static validation and parsing for Workday tenant URLs. No network calls —
 * this catches typos and obviously-bad URLs before the probe stage.
 *
 * The transformation:
 *
 *   public URL:  https://generalmotors.wd5.myworkdayjobs.com/Careers_GM
 *                └──────┬─────┘ └─┬─┘                       └────┬───┘
 *                   tenant       pod                            site
 *
 *   API URL:     https://generalmotors.wd5.myworkdayjobs.com/wday/cxs/generalmotors/Careers_GM/jobs
 *
 * The site name is whatever the last path segment of the public URL happens
 * to be — for some tenants it's a descriptive name (Careers_GM, External),
 * for others it's literally `search`, for some it's even `jobs`. We don't
 * second-guess; whatever's there is the site.
 *
 * Pods are wd1 through wd9 plus wd103, wd104, wd105 (US datacenter regions).
 * The pattern accepts any wdN to be future-proof.
 */

const HOST_PATTERN = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i;

export interface WorkdayUrlParts {
  /** Tenant subdomain, e.g. 'generalmotors' */
  tenant: string;
  /** Pod identifier, e.g. 'wd5' — opaque to us but kept for diagnostics */
  pod: string;
  /** Site name (last path segment), e.g. 'Careers_GM', 'search', 'External' */
  site: string;
  /** Origin for building further URLs, e.g. 'https://generalmotors.wd5.myworkdayjobs.com' */
  base: string;
}

export interface ParseResult {
  ok: boolean;
  /** Populated when ok=true */
  parts?: WorkdayUrlParts;
  /** Populated when ok=false */
  error?: string;
}

/**
 * Parse a public Workday URL into its components. Returns a discriminated
 * result so callers can surface a useful error message to the user.
 */
export function parseWorkdayUrl(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'URL is empty' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'not a valid URL' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: `unexpected protocol ${url.protocol}` };
  }

  const hostMatch = HOST_PATTERN.exec(url.hostname);
  if (!hostMatch) {
    return {
      ok: false,
      error: `host '${url.hostname}' is not a Workday tenant. Expected pattern: {tenant}.wd{N}.myworkdayjobs.com`,
    };
  }

  const tenant = hostMatch[1]!.toLowerCase();
  const pod = hostMatch[2]!.toLowerCase();

  // Strip any trailing slash, query, hash. Take the last non-empty segment.
  // This handles paths like /Careers_GM, /Careers_GM/, /en-US/search,
  // /search?source=banner, etc. The last segment is what Workday treats as
  // the site.
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { ok: false, error: 'URL has no site path segment (e.g. /Careers_GM)' };
  }
  const site = segments[segments.length - 1]!;

  // The Workday API URL we will build later:
  //   {base}/wday/cxs/{tenant}/{site}/jobs
  // Computing it here would be premature — the adapter does it — but we
  // expose `base` so the adapter can construct any sub-URL it needs.
  return {
    ok: true,
    parts: {
      tenant,
      pod,
      site,
      base: url.origin,
    },
  };
}

/**
 * Convenience: build the listing endpoint URL for a parsed tenant.
 *
 *   buildListingUrl({tenant:'generalmotors', site:'Careers_GM', base:'https://generalmotors.wd5.myworkdayjobs.com', ...})
 *     → 'https://generalmotors.wd5.myworkdayjobs.com/wday/cxs/generalmotors/Careers_GM/jobs'
 */
export function buildListingUrl(parts: WorkdayUrlParts): string {
  return `${parts.base}/wday/cxs/${parts.tenant}/${parts.site}/jobs`;
}

/**
 * Convenience: build a job-detail endpoint URL.
 *
 *   buildDetailUrl(parts, '/job/Toluca-Mexico-Mexico/Becario-..._JR-202610113')
 *     → 'https://.../wday/cxs/generalmotors/Careers_GM/job/Toluca-Mexico-Mexico/Becario-..._JR-202610113'
 *
 * The externalPath from the listing response always starts with a `/job/`
 * prefix. We concatenate against the site root in the API namespace.
 */
export function buildDetailUrl(parts: WorkdayUrlParts, externalPath: string): string {
  const path = externalPath.startsWith('/') ? externalPath : `/${externalPath}`;
  return `${parts.base}/wday/cxs/${parts.tenant}/${parts.site}${path}`;
}
