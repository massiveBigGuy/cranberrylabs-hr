import type { DB } from '../../services/db';

/**
 * Repo-shaped DB access for the jobs module. Keeps SQL out of the router
 * and gives us a single place to add prepared-statement caching later.
 *
 * The row shape mirrors the `jobs` table from §3 of the schema verbatim;
 * we re-export it as `JobRow` for use by the router and any future module
 * that wants to consume jobs (e.g. applications in step 6).
 */
export interface JobRow {
  id: number;
  source_id: number;
  external_id: string;
  title: string;
  company: string;
  location: string | null;
  remote_type: string | null;
  url: string;
  description: string;
  description_hash: string;
  posted_date: string | null;
  discovered_at: string;
  hiring_manager: string | null;
  hiring_manager_source: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  fit_score: number | null;
  fit_reasons: string | null;
  status: JobStatus;
  dismissed_reason: string | null;
}

export type JobStatus =
  | 'new'
  | 'reviewing'
  | 'dismissed'
  | 'queued'
  | 'generating'
  | 'ready'
  | 'applied'
  | 'archived';

const ALLOWED_STATUSES: readonly JobStatus[] = [
  'new',
  'reviewing',
  'dismissed',
  'queued',
  'generating',
  'ready',
  'applied',
  'archived',
];

export function isJobStatus(s: unknown): s is JobStatus {
  return typeof s === 'string' && (ALLOWED_STATUSES as readonly string[]).includes(s);
}

/**
 * Listing options surface every query-string knob from §4's GET /api/jobs.
 * All optional — the router parses req.query and passes through. Server
 * defaults apply for limit/offset.
 */
export interface ListJobsOptions {
  statuses?: JobStatus[];     // ?status=new,reviewing  → ['new','reviewing']
  since?: string;             // ?since=2026-05-11      → ISO date
  minFit?: number;            // ?min_fit=0.6           → number 0..1
  tagIds?: number[];          // ?tag=remote (resolved to id upstream)
  sourceId?: number;          // ?source_id=3
  search?: string;            // ?search=sysadmin       → matched against title/company
  limit?: number;             // default 50, capped at 200
  offset?: number;            // default 0
  /**
   * Server-side keyword filter from config.scraper.filters. Applied as
   * literal substring matches against title + description. We hold this
   * separate from `search` because:
   *   - `search` is user-driven and may be empty (show everything)
   *   - `keywordFilter` is the always-on noise reducer
   * If `applyKeywordFilter` is false, the filter is skipped entirely
   * (used by the /jobs/all view in a future step).
   */
  applyKeywordFilter?: boolean;
  keywordFilter?: {
    include?: string[];
    exclude?: string[];
  };
}

export interface ListJobsResult {
  jobs: JobRow[];
  total: number;
  offset: number;
  limit: number;
}

export class JobsRepo {
  constructor(private readonly db: DB) {}

  list(opts: ListJobsOptions): ListJobsResult {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (opts.statuses && opts.statuses.length > 0) {
      // Build a dynamic IN clause with named placeholders to keep param
      // binding safe regardless of how many statuses.
      const keys = opts.statuses.map((_, i) => `:status_${i}`);
      where.push(`status IN (${keys.join(',')})`);
      opts.statuses.forEach((s, i) => {
        params[`status_${i}`] = s;
      });
    }

    if (opts.since) {
      where.push('(posted_date IS NOT NULL AND posted_date >= :since)');
      params.since = opts.since;
    }

    if (typeof opts.minFit === 'number') {
      where.push('(fit_score IS NOT NULL AND fit_score >= :min_fit)');
      params.min_fit = opts.minFit;
    }

    if (typeof opts.sourceId === 'number') {
      where.push('source_id = :source_id');
      params.source_id = opts.sourceId;
    }

    if (opts.search && opts.search.trim()) {
      where.push('(LOWER(title) LIKE :search OR LOWER(company) LIKE :search)');
      params.search = `%${opts.search.trim().toLowerCase()}%`;
    }

    if (opts.tagIds && opts.tagIds.length > 0) {
      // Match jobs having ALL the requested tags. The HAVING count(...)
      // pattern is the standard SQL approach for set-containment.
      const tagKeys = opts.tagIds.map((_, i) => `:tag_${i}`);
      where.push(`id IN (
        SELECT job_id FROM job_tags
        WHERE tag_id IN (${tagKeys.join(',')})
        GROUP BY job_id
        HAVING COUNT(DISTINCT tag_id) = ${opts.tagIds.length}
      )`);
      opts.tagIds.forEach((t, i) => {
        params[`tag_${i}`] = t;
      });
    }

    if (opts.applyKeywordFilter && opts.keywordFilter) {
      const inc = opts.keywordFilter.include ?? [];
      const exc = opts.keywordFilter.exclude ?? [];

      if (inc.length > 0) {
        // At least one include keyword must match title OR description.
        // We lowercase both sides since the filter is case-insensitive.
        const incExprs: string[] = [];
        inc.forEach((kw, i) => {
          const key = `:inc_${i}`;
          incExprs.push(`(LOWER(title) LIKE ${key} OR LOWER(description) LIKE ${key})`);
          params[`inc_${i}`] = `%${kw.toLowerCase()}%`;
        });
        where.push(`(${incExprs.join(' OR ')})`);
      }

      if (exc.length > 0) {
        // No exclude keyword may match title OR description.
        exc.forEach((kw, i) => {
          const key = `:exc_${i}`;
          where.push(`(LOWER(title) NOT LIKE ${key} AND LOWER(description) NOT LIKE ${key})`);
          params[`exc_${i}`] = `%${kw.toLowerCase()}%`;
        });
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // ORDER BY: prefer posted_date desc when present, fall back to discovered_at.
    // Ties broken by id desc so newest scraped row wins.
    const orderSql = `ORDER BY COALESCE(posted_date, discovered_at) DESC, id DESC`;

    const total = this.db
      .prepare(`SELECT COUNT(*) as n FROM jobs ${whereSql}`)
      .get(params) as { n: number };

    const rows = this.db
      .prepare(
        `SELECT * FROM jobs ${whereSql} ${orderSql} LIMIT :limit OFFSET :offset`,
      )
      .all({ ...params, limit, offset }) as JobRow[];

    return { jobs: rows, total: total.n, offset, limit };
  }

  get(id: number): JobRow | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    return row ?? null;
  }

  updateStatus(id: number, status: JobStatus, dismissedReason?: string | null): JobRow | null {
    // Coupling status to dismissed_reason in one statement keeps the row
    // consistent — there's no intermediate state where status is
    // 'dismissed' but the reason is stale from a previous dismissal.
    if (status === 'dismissed') {
      this.db
        .prepare('UPDATE jobs SET status = ?, dismissed_reason = ? WHERE id = ?')
        .run(status, dismissedReason ?? null, id);
    } else {
      // Moving out of dismissed clears the reason.
      this.db
        .prepare('UPDATE jobs SET status = ?, dismissed_reason = NULL WHERE id = ?')
        .run(status, id);
    }
    return this.get(id);
  }

  updateHiringManager(id: number, name: string | null, source: string | null): JobRow | null {
    this.db
      .prepare('UPDATE jobs SET hiring_manager = ?, hiring_manager_source = ? WHERE id = ?')
      .run(name, source, id);
    return this.get(id);
  }

  tagsFor(jobId: number): { id: number; name: string; color: string | null }[] {
    return this.db
      .prepare(
        `SELECT t.id, t.name, t.color
         FROM tags t
         INNER JOIN job_tags jt ON jt.tag_id = t.id
         WHERE jt.job_id = ?
         ORDER BY t.name ASC`,
      )
      .all(jobId) as { id: number; name: string; color: string | null }[];
  }
}
