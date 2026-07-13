import type { DB } from '../../services/db';

export interface JobRow {
  id: number;
  source_id: number;
  user_id: string;
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
  | 'archived'
  | 'duplicate';

const ALLOWED_STATUSES: readonly JobStatus[] = [
  'new',
  'reviewing',
  'dismissed',
  'queued',
  'generating',
  'ready',
  'applied',
  'archived',
  'duplicate',
];

export function isJobStatus(s: unknown): s is JobStatus {
  return typeof s === 'string' && (ALLOWED_STATUSES as readonly string[]).includes(s);
}

export interface ListJobsOptions {
  userId?: string;            // when provided, scopes results to this user
  statuses?: JobStatus[];
  since?: string;
  minFit?: number;
  tagIds?: number[];
  sourceId?: number;
  profileId?: number;         // filter to jobs whose source belongs to this profile
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'fit' | 'date';
  applyKeywordFilter?: boolean;
  keywordFilter?: {
    include?: string[];
    exclude?: string[];
  };
}

export interface JobStats {
  total: number;
  by_status: Record<string, number>;
  passing_keyword_filter: number;
  filtered_out_by_keywords: number;
  missing_description: number;
  detail_fetch: {
    pending: number;
    ok: number;
    gave_up: number;
  };
}

export interface ListJobsResult {
  jobs: JobRow[];
  total: number;
  total_unfiltered: number;
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

    if (opts.userId) {
      where.push('user_id = :user_id');
      params.user_id = opts.userId;
    }

    if (opts.statuses && opts.statuses.length > 0) {
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

    if (typeof opts.profileId === 'number') {
      where.push('source_id IN (SELECT id FROM sources WHERE profile_id = :profile_id)');
      params.profile_id = opts.profileId;
    }

    if (opts.search && opts.search.trim()) {
      where.push('(LOWER(title) LIKE :search OR LOWER(company) LIKE :search)');
      params.search = `%${opts.search.trim().toLowerCase()}%`;
    }

    if (opts.tagIds && opts.tagIds.length > 0) {
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
        const incExprs: string[] = [];
        inc.forEach((kw, i) => {
          const key = `:inc_${i}`;
          incExprs.push(`(LOWER(title) LIKE ${key} OR LOWER(description) LIKE ${key})`);
          params[`inc_${i}`] = `%${kw.toLowerCase()}%`;
        });
        where.push(`(${incExprs.join(' OR ')})`);
      }

      if (exc.length > 0) {
        exc.forEach((kw, i) => {
          const key = `:exc_${i}`;
          where.push(`(LOWER(title) NOT LIKE ${key} AND LOWER(description) NOT LIKE ${key})`);
          params[`exc_${i}`] = `%${kw.toLowerCase()}%`;
        });
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const orderSql =
      opts.sortBy === 'date'
        ? `ORDER BY COALESCE(posted_date, discovered_at) DESC, id DESC`
        : `ORDER BY fit_score DESC NULLS LAST, COALESCE(posted_date, discovered_at) DESC, id DESC`;

    const total = this.db
      .prepare(`SELECT COUNT(*) as n FROM jobs ${whereSql}`)
      .get(params) as { n: number };

    // total_unfiltered: all jobs for this user (ignores status/keyword filters)
    const unfilteredSql = opts.userId
      ? 'SELECT COUNT(*) as n FROM jobs WHERE user_id = :user_id'
      : 'SELECT COUNT(*) as n FROM jobs';
    const totalUnfiltered = this.db
      .prepare(unfilteredSql)
      .get(opts.userId ? { user_id: opts.userId } : {}) as { n: number };

    const rows = this.db
      .prepare(`SELECT * FROM jobs ${whereSql} ${orderSql} LIMIT :limit OFFSET :offset`)
      .all({ ...params, limit, offset }) as JobRow[];

    return {
      jobs: rows,
      total: total.n,
      total_unfiltered: totalUnfiltered.n,
      offset,
      limit,
    };
  }

  get(id: number): JobRow | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    return row ?? null;
  }

  updateStatus(id: number, status: JobStatus, dismissedReason?: string | null): JobRow | null {
    if (status === 'dismissed') {
      this.db
        .prepare('UPDATE jobs SET status = ?, dismissed_reason = ? WHERE id = ?')
        .run(status, dismissedReason ?? null, id);
    } else {
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

  updateFitScore(id: number, score: number, reasons: string): void {
    this.db
      .prepare('UPDATE jobs SET fit_score = ?, fit_reasons = ? WHERE id = ?')
      .run(score, reasons, id);
  }

  findNeedingFitScore(): Pick<JobRow, 'id' | 'title' | 'description'>[] {
    return this.db
      .prepare(
        `SELECT id, title, description FROM jobs
         WHERE description != ''
           AND description IS NOT NULL
           AND (fit_score IS NULL)`,
      )
      .all() as Pick<JobRow, 'id' | 'title' | 'description'>[];
  }

  insertManual(input: {
    source_id: number;
    external_id: string;
    title: string;
    company: string;
    url: string;
    description: string;
    description_hash: string;
    location: string | null;
    remote_type: string | null;
    posted_date: string | null;
    fit_score: number | null;
    fit_reasons: string | null;
    user_id: string;
  }): JobRow {
    return this.db
      .prepare(
        `INSERT INTO jobs (
          source_id, external_id, title, company, url, description, description_hash,
          location, remote_type, posted_date, fit_score, fit_reasons,
          detail_fetch_status, user_id
        ) VALUES (
          :source_id, :external_id, :title, :company, :url, :description, :description_hash,
          :location, :remote_type, :posted_date, :fit_score, :fit_reasons,
          'ok', :user_id
        )
        RETURNING *`,
      )
      .get(input) as JobRow;
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

  stats(userId?: string, keywordFilter?: { include?: string[]; exclude?: string[] }): JobStats {
    const userClause = userId ? `WHERE user_id = ?` : '';
    const userAndClause = userId ? `AND user_id = ?` : '';
    const userParam = userId ? [userId] : [];

    const total = (
      this.db.prepare(`SELECT COUNT(*) as n FROM jobs ${userClause}`).get(...userParam) as {
        n: number;
      }
    ).n;

    const statusRows = this.db
      .prepare(`SELECT status, COUNT(*) as n FROM jobs ${userClause} GROUP BY status`)
      .all(...userParam) as { status: string; n: number }[];
    const byStatus: Record<string, number> = {};
    for (const r of statusRows) byStatus[r.status] = r.n;

    const fetchRows = this.db
      .prepare(
        `SELECT detail_fetch_status as s, COUNT(*) as n FROM jobs ${userClause} GROUP BY detail_fetch_status`,
      )
      .all(...userParam) as { s: string; n: number }[];
    const detailFetch = { pending: 0, ok: 0, gave_up: 0 };
    for (const r of fetchRows) {
      if (r.s in detailFetch) detailFetch[r.s as keyof typeof detailFetch] = r.n;
    }

    const missingDescription = (
      this.db
        .prepare(
          `SELECT COUNT(*) as n FROM jobs WHERE (description IS NULL OR description = '') ${userAndClause}`,
        )
        .get(...userParam) as { n: number }
    ).n;

    let passing = 0;
    if (keywordFilter && (keywordFilter.include?.length || keywordFilter.exclude?.length)) {
      const where: string[] = [`status != 'dismissed'`];
      const params: Record<string, unknown> = {};
      if (userId) {
        where.push('user_id = :user_id');
        params.user_id = userId;
      }
      const inc = keywordFilter.include ?? [];
      const exc = keywordFilter.exclude ?? [];

      if (inc.length > 0) {
        const exprs: string[] = [];
        inc.forEach((kw, i) => {
          exprs.push(`(LOWER(title) LIKE :inc_${i} OR LOWER(description) LIKE :inc_${i})`);
          params[`inc_${i}`] = `%${kw.toLowerCase()}%`;
        });
        where.push(`(${exprs.join(' OR ')})`);
      }
      exc.forEach((kw, i) => {
        where.push(`(LOWER(title) NOT LIKE :exc_${i} AND LOWER(description) NOT LIKE :exc_${i})`);
        params[`exc_${i}`] = `%${kw.toLowerCase()}%`;
      });

      passing = (
        this.db
          .prepare(`SELECT COUNT(*) as n FROM jobs WHERE ${where.join(' AND ')}`)
          .get(params) as { n: number }
      ).n;
    } else {
      const nonDismissedSql = userId
        ? `SELECT COUNT(*) as n FROM jobs WHERE status != 'dismissed' AND user_id = ?`
        : `SELECT COUNT(*) as n FROM jobs WHERE status != 'dismissed'`;
      passing = (
        this.db.prepare(nonDismissedSql).get(...userParam) as { n: number }
      ).n;
    }

    const nonDismissedSql = userId
      ? `SELECT COUNT(*) as n FROM jobs WHERE status != 'dismissed' AND user_id = ?`
      : `SELECT COUNT(*) as n FROM jobs WHERE status != 'dismissed'`;
    const nonDismissed = (
      this.db.prepare(nonDismissedSql).get(...userParam) as { n: number }
    ).n;

    return {
      total,
      by_status: byStatus,
      passing_keyword_filter: passing,
      filtered_out_by_keywords: nonDismissed - passing,
      missing_description: missingDescription,
      detail_fetch: detailFetch,
    };
  }
}
