import type { DB } from '../../services/db';

export type ScrapeRunStatus = 'running' | 'ok' | 'error' | 'blocked';

export interface ScrapeRunRow {
  id: number;
  source_id: number;
  started_at: string;
  finished_at: string | null;
  status: ScrapeRunStatus;
  jobs_found: number;
  jobs_new: number;
  error_message: string | null;
}

export class ScrapeRunsRepo {
  constructor(private readonly db: DB) {}

  start(sourceId: number): ScrapeRunRow {
    return this.db
      .prepare(
        `INSERT INTO scrape_runs (source_id, status)
         VALUES (?, 'running')
         RETURNING *`,
      )
      .get(sourceId) as ScrapeRunRow;
  }

  finishOk(id: number, jobsFound: number, jobsNew: number): void {
    this.db
      .prepare(
        `UPDATE scrape_runs
         SET finished_at = datetime('now'),
             status      = 'ok',
             jobs_found  = ?,
             jobs_new    = ?
         WHERE id = ?`,
      )
      .run(jobsFound, jobsNew, id);
  }

  finishError(id: number, message: string, status: ScrapeRunStatus = 'error'): void {
    this.db
      .prepare(
        `UPDATE scrape_runs
         SET finished_at   = datetime('now'),
             status        = ?,
             error_message = ?
         WHERE id = ?`,
      )
      .run(status, message, id);
  }

  recentForSource(sourceId: number, limit: number): ScrapeRunRow[] {
    return this.db
      .prepare(
        `SELECT * FROM scrape_runs
         WHERE source_id = ?
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(sourceId, limit) as ScrapeRunRow[];
  }
}
