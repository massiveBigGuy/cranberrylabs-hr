import type { DB } from '../../services/db';

export interface RetentionPolicy {
  id: number;
  name: string;
  description: string | null;
  ttl_days: number | null;
  is_default: number;
  created_at: string;
}

export interface RetentionRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  apps_scanned: number;
  apps_purged: number;
  apps_skipped_pinned: number;
  status: string | null;
  error_message: string | null;
}

export interface RetentionEvent {
  id: number;
  application_id: number;
  job_title: string | null;
  company: string | null;
  action: string;
  reason: string | null;
  created_at: string;
}

export interface PurgeCandidate {
  id: number;
  user_id: string;
  job_id: number;
  resume_path: string | null;
  cover_letter_path: string | null;
  job_title: string;
  job_company: string;
}

export class RetentionRepo {
  constructor(private readonly db: DB) {}

  listPolicies(): RetentionPolicy[] {
    return this.db
      .prepare('SELECT * FROM retention_policies ORDER BY id')
      .all() as RetentionPolicy[];
  }

  getPolicy(name: string): RetentionPolicy | null {
    return (
      (this.db
        .prepare('SELECT * FROM retention_policies WHERE name = ?')
        .get(name) as RetentionPolicy | undefined) ?? null
    );
  }

  createPolicy(data: {
    name: string;
    description?: string | null;
    ttl_days?: number | null;
  }): RetentionPolicy {
    return this.db
      .prepare(
        `INSERT INTO retention_policies (name, description, ttl_days)
         VALUES (?, ?, ?)
         RETURNING *`,
      )
      .get(data.name, data.description ?? null, data.ttl_days ?? null) as RetentionPolicy;
  }

  updatePolicy(
    id: number,
    data: { description?: string | null; ttl_days?: number | null },
  ): RetentionPolicy | null {
    const sets: string[] = [];
    const params: unknown[] = [];
    if ('description' in data) {
      sets.push('description = ?');
      params.push(data.description ?? null);
    }
    if ('ttl_days' in data) {
      sets.push('ttl_days = ?');
      params.push(data.ttl_days ?? null);
    }
    if (sets.length === 0) {
      return (
        (this.db
          .prepare('SELECT * FROM retention_policies WHERE id = ?')
          .get(id) as RetentionPolicy | undefined) ?? null
      );
    }
    params.push(id);
    return (
      (this.db
        .prepare(`UPDATE retention_policies SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
        .get(...params) as RetentionPolicy | undefined) ?? null
    );
  }

  startRun(): RetentionRun {
    return this.db
      .prepare(
        `INSERT INTO retention_runs (apps_scanned, apps_purged, apps_skipped_pinned)
         VALUES (0, 0, 0) RETURNING *`,
      )
      .get() as RetentionRun;
  }

  finishRun(
    id: number,
    data: {
      apps_scanned: number;
      apps_purged: number;
      apps_skipped_pinned: number;
      status: 'ok' | 'error';
      error_message?: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE retention_runs
         SET finished_at = datetime('now'), apps_scanned = ?, apps_purged = ?,
             apps_skipped_pinned = ?, status = ?, error_message = ?
         WHERE id = ?`,
      )
      .run(
        data.apps_scanned,
        data.apps_purged,
        data.apps_skipped_pinned,
        data.status,
        data.error_message ?? null,
        id,
      );
  }

  listRuns(limit = 20): RetentionRun[] {
    return this.db
      .prepare('SELECT * FROM retention_runs ORDER BY started_at DESC LIMIT ?')
      .all(limit) as RetentionRun[];
  }

  recordEvent(data: {
    application_id: number;
    job_title: string | null;
    company: string | null;
    action: string;
    reason?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO retention_events (application_id, job_title, company, action, reason)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        data.application_id,
        data.job_title,
        data.company,
        data.action,
        data.reason ?? null,
      );
  }

  listEvents(applicationId?: number, limit = 50): RetentionEvent[] {
    if (applicationId !== undefined) {
      return this.db
        .prepare(
          'SELECT * FROM retention_events WHERE application_id = ? ORDER BY created_at DESC LIMIT ?',
        )
        .all(applicationId, limit) as RetentionEvent[];
    }
    return this.db
      .prepare('SELECT * FROM retention_events ORDER BY created_at DESC LIMIT ?')
      .all(limit) as RetentionEvent[];
  }

  findPurgeCandidates(): PurgeCandidate[] {
    return this.db
      .prepare(
        `SELECT a.id, a.user_id, a.job_id, a.resume_path, a.cover_letter_path,
                j.title AS job_title, j.company AS job_company
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         WHERE a.expires_at IS NOT NULL
           AND a.expires_at <= datetime('now')
           AND a.pinned_at IS NULL
           AND a.purged_at IS NULL`,
      )
      .all() as PurgeCandidate[];
  }
}
