import type { DB } from '../../services/db';
import type { NormalizedJob } from './adapters/types';

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
  status: string;
  dismissed_reason: string | null;
}

export interface UpsertResult {
  /** Number of rows that were INSERTed (not previously known). */
  inserted: number;
  /** Number of rows that already existed (UNIQUE conflict). */
  existed: number;
}

export class JobsRepo {
  constructor(private readonly db: DB) {}

  /**
   * Bulk upsert with dedup via (source_id, external_id) UNIQUE constraint.
   * Uses INSERT ... ON CONFLICT DO NOTHING so re-running a scrape is
   * idempotent. Wrapped in a single transaction for speed.
   *
   * Returns the count of new vs existing so the scrape_run row can report
   * jobs_new accurately.
   */
  upsertMany(sourceId: number, jobs: NormalizedJob[]): UpsertResult {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        source_id, external_id, title, company, location, remote_type,
        url, description, description_hash, posted_date,
        salary_min, salary_max, salary_currency
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
      ON CONFLICT(source_id, external_id) DO NOTHING
    `);

    let inserted = 0;
    const tx = this.db.transaction((items: NormalizedJob[]) => {
      for (const j of items) {
        const info = stmt.run(
          sourceId,
          j.external_id,
          j.title,
          j.company,
          j.location,
          j.remote_type,
          j.url,
          j.description,
          j.description_hash,
          j.posted_date,
          j.salary_min,
          j.salary_max,
          j.salary_currency,
        );
        if (info.changes > 0) inserted++;
      }
    });
    tx(jobs);
    return { inserted, existed: jobs.length - inserted };
  }

  /**
   * Find jobs that still need their full description fetched. Used by the
   * phase-2 detail-fetch worker.
   *
   * Limit lets the cron task cap how many it processes per run, so it
   * spreads out polite request pacing rather than firing a thundering herd.
   *
   * Excludes jobs the sweep has given up on (detail_fetch_status =
   * 'gave_up') and jobs that have hit the attempt ceiling — the
   * attempt-count check is belt-and-suspenders against a status write
   * that never landed. Either condition alone is sufficient.
   */
  findMissingDescriptions(limit: number, maxAttempts: number): JobRow[] {
    return this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE description = ''
           AND status NOT IN ('dismissed', 'archived')
           AND detail_fetch_status != 'gave_up'
           AND detail_fetch_attempts < :maxAttempts
         ORDER BY discovered_at ASC
         LIMIT :limit`,
      )
      .all({ maxAttempts, limit }) as JobRow[];
  }

  updateDescription(
    id: number,
    description: string,
    descriptionHash: string,
    hiringManager: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE jobs
         SET description = ?,
             description_hash = ?,
             hiring_manager = COALESCE(hiring_manager, ?),
             hiring_manager_source = CASE
               WHEN hiring_manager IS NULL AND ? IS NOT NULL THEN 'jd'
               ELSE hiring_manager_source
             END,
             detail_fetch_status = 'ok',
             detail_fetch_attempts = detail_fetch_attempts + 1
         WHERE id = ?`,
      )
      .run(description, descriptionHash, hiringManager, hiringManager, id);
  }

  countBySource(sourceId: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM jobs WHERE source_id = ?')
      .get(sourceId) as { n: number };
    return row.n;
  }

  /**
   * Record a failed detail fetch: bump the attempt counter, and flip the
   * job to 'gave_up' if it has now hit the ceiling. Returns the new
   * attempt count and whether the job was given up, so the caller can
   * log appropriately.
   */
  recordDetailFetchFailure(
    id: number,
    maxAttempts: number,
  ): { attempts: number; gaveUp: boolean } {
    const row = this.db
      .prepare(
        `UPDATE jobs SET detail_fetch_attempts = detail_fetch_attempts + 1
         WHERE id = ? RETURNING detail_fetch_attempts`,
      )
      .get(id) as { detail_fetch_attempts: number };

    const gaveUp = row.detail_fetch_attempts >= maxAttempts;
    if (gaveUp) {
      this.db
        .prepare(`UPDATE jobs SET detail_fetch_status = 'gave_up' WHERE id = ?`)
        .run(id);
    }
    return { attempts: row.detail_fetch_attempts, gaveUp };
  }

}