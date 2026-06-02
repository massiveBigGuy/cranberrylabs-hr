import type { DB } from '../../services/db';

export interface ApplicationRow {
  id: number;
  job_id: number;
  user_id: string;
  status: string;
  queue_job_id: string | null;
  model_used: string | null;
  resume_version_id: number | null;
  resume_path: string | null;
  cover_letter_path: string | null;
  resume_diff: string | null;
  generation_notes: string | null;
  generation_error: string | null;
  generated_at: string | null;
  submitted_at: string | null;
  submission_notes: string | null;
  pinned_at: string | null;
  retention_policy: string;
  expires_at: string | null;
  purged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicationWithJob extends ApplicationRow {
  job_title: string;
  job_company: string;
  job_url: string;
  job_fit_score: number | null;
}

export type ApplicationStatus =
  | 'queued'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'applied'
  | 'archived';

const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'queued',
  'generating',
  'ready',
  'failed',
  'applied',
  'archived',
];

export function isApplicationStatus(s: unknown): s is ApplicationStatus {
  return typeof s === 'string' && (APPLICATION_STATUSES as readonly string[]).includes(s);
}

const JOINED_SELECT = `
  SELECT a.*, j.title AS job_title, j.company AS job_company,
         j.url AS job_url, j.fit_score AS job_fit_score
  FROM applications a
  JOIN jobs j ON j.id = a.job_id`;

export class ApplicationsRepo {
  constructor(private readonly db: DB) {}

  create(jobId: number, userId: string, resumeVersionId: number | null): ApplicationRow {
    return this.db
      .prepare(
        `INSERT INTO applications (job_id, user_id, status, resume_version_id)
         VALUES (?, ?, 'queued', ?)
         RETURNING *`,
      )
      .get(jobId, userId, resumeVersionId ?? null) as ApplicationRow;
  }

  updateStatus(id: number, status: ApplicationStatus): void {
    this.db
      .prepare(`UPDATE applications SET status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status, id);
  }

  get(id: number): ApplicationWithJob | null {
    return (
      (this.db
        .prepare(`${JOINED_SELECT} WHERE a.id = ?`)
        .get(id) as ApplicationWithJob | undefined) ?? null
    );
  }

  getByJobId(jobId: number, userId?: string): ApplicationWithJob | null {
    if (userId !== undefined) {
      return (
        (this.db
          .prepare(`${JOINED_SELECT} WHERE a.job_id = ? AND a.user_id = ?`)
          .get(jobId, userId) as ApplicationWithJob | undefined) ?? null
      );
    }
    return (
      (this.db
        .prepare(`${JOINED_SELECT} WHERE a.job_id = ?`)
        .get(jobId) as ApplicationWithJob | undefined) ?? null
    );
  }

  list({
    status,
    jobId,
    userId,
  }: { status?: ApplicationStatus; jobId?: number; userId?: string } = {}): ApplicationWithJob[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (userId !== undefined) {
      conditions.push('a.user_id = ?');
      params.push(userId);
    }
    if (status) {
      conditions.push('a.status = ?');
      params.push(status);
    }
    if (jobId !== undefined) {
      conditions.push('a.job_id = ?');
      params.push(jobId);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const sql = `${JOINED_SELECT}${where} ORDER BY a.created_at DESC`;

    return this.db.prepare(sql).all(...params) as ApplicationWithJob[];
  }

  updateGenerated(
    id: number,
    data: {
      modelUsed: string;
      resumePath: string;
      coverPath: string;
      diff: string;
      resumeVersionId: number;
    },
  ): ApplicationRow | null {
    const result = this.db
      .prepare(
        `UPDATE applications
         SET status = 'ready', model_used = ?, resume_path = ?, cover_letter_path = ?,
             resume_diff = ?, resume_version_id = ?,
             generated_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(data.modelUsed, data.resumePath, data.coverPath, data.diff, data.resumeVersionId, id);
    if (!result.changes) return null;
    return this.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as ApplicationRow;
  }

  updateFailed(id: number, error: string): ApplicationRow | null {
    const result = this.db
      .prepare(
        `UPDATE applications
         SET status = 'failed', generation_error = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(error, id);
    if (!result.changes) return null;
    return this.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as ApplicationRow;
  }

  submit(id: number, notes: string | null): ApplicationRow | null {
    const result = this.db
      .prepare(
        `UPDATE applications
         SET status = 'applied', submitted_at = datetime('now'),
             submission_notes = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(notes ?? null, id);
    if (!result.changes) return null;
    return this.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as ApplicationRow;
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM applications WHERE id = ?').run(id);
    return result.changes > 0;
  }

  addEvent(applicationId: number, eventType: string, payload?: unknown): void {
    this.db
      .prepare(
        'INSERT INTO application_events (application_id, event_type, payload) VALUES (?, ?, ?)',
      )
      .run(
        applicationId,
        eventType,
        payload !== undefined ? JSON.stringify(payload) : null,
      );
  }
}
