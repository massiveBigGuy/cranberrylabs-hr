import type { DB } from '../../services/db';
import type { NormalizedJob } from './adapters/types';
import { parseLocation } from './location-parser';

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
  status: string;
  dismissed_reason: string | null;
  location_country: string | null;
  location_state: string | null;
  location_city: string | null;
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
  upsertMany(sourceId: number, userId: string, jobs: NormalizedJob[]): UpsertResult {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        source_id, user_id, external_id, title, company, location, remote_type,
        url, description, description_hash, posted_date,
        salary_min, salary_max, salary_currency,
        location_country, location_state, location_city
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?
      )
      ON CONFLICT(source_id, external_id) DO NOTHING
    `);

    let inserted = 0;
    const tx = this.db.transaction((items: NormalizedJob[]) => {
      for (const j of items) {
        const parsedLocation = parseLocation(j.location, j.remote_type);
        const info = stmt.run(
          sourceId,
          userId,
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
          parsedLocation.country,
          parsedLocation.state,
          parsedLocation.city,
        );
        if (info.changes > 0) {
          inserted++;

          // Cross-source dedup for one-phase adapters (Lever, Ashby): their
          // rows already carry a real description_hash at insert time, so
          // they never have an empty description and never enter
          // detail-sweep.ts's candidate query — the dedup check that lives
          // there would never run for them. Run the same check here for any
          // row that already has a hash; two-phase rows (Workday,
          // Greenhouse) still insert with description_hash = '' and are
          // deduped later by the sweep as before.
          if (j.description_hash) {
            const newId = Number(info.lastInsertRowid);
            const dup = this.findCrossSourceDuplicate(userId, j.company, j.description_hash, newId);
            if (dup) this.markDuplicateIfNew(newId);
          }
        }
      }
    });
    tx(jobs);
    return { inserted, existed: jobs.length - inserted };
  }

  /**
   * Find jobs that still need their full description fetched. Used by the
   * phase-2 detail-fetch worker. System operation — not scoped to a user.
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

  updateFitScore(id: number, score: number, reasons: string): void {
    this.db
      .prepare('UPDATE jobs SET fit_score = ?, fit_reasons = ? WHERE id = ?')
      .run(score, reasons, id);
  }

  countBySource(sourceId: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM jobs WHERE source_id = ?')
      .get(sourceId) as { n: number };
    return row.n;
  }

  /**
   * Look for another job (any source) belonging to the same user with the
   * same company and description_hash. Only meaningful once a real hash has
   * been computed (phase 2) — description_hash is '' for every job at
   * insert time, so callers must not invoke this with an empty hash.
   */
  findCrossSourceDuplicate(
    userId: string,
    company: string,
    descriptionHash: string,
    excludeJobId: number,
  ): { id: number } | undefined {
    return this.db
      .prepare(
        `SELECT id FROM jobs
         WHERE user_id = :userId
           AND company = :company
           AND description_hash = :descriptionHash
           AND id != :excludeJobId
         LIMIT 1`,
      )
      .get({ userId, company, descriptionHash, excludeJobId }) as { id: number } | undefined;
  }

  /**
   * Flip a job to 'duplicate' status. Guarded on status = 'new' so we never
   * clobber a status the user already set (reviewing/dismissed/etc.) by
   * hand before the detail sweep got to it.
   */
  markDuplicateIfNew(id: number): boolean {
    const info = this.db
      .prepare(`UPDATE jobs SET status = 'duplicate' WHERE id = ? AND status = 'new'`)
      .run(id);
    return info.changes > 0;
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
