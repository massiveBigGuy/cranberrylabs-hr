import type { Migration } from '../../services/db/migrations';

export const migrations: Migration[] = [
  {
    id: 'applications_001_tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE applications (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id            INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
          user_id           TEXT    NOT NULL,
          status            TEXT    NOT NULL DEFAULT 'queued',
          queue_job_id      TEXT,
          model_used        TEXT,
          resume_version_id INTEGER REFERENCES master_resume(id),
          resume_path       TEXT,
          cover_letter_path TEXT,
          resume_diff       TEXT,
          generation_notes  TEXT,
          generation_error  TEXT,
          generated_at      TEXT,
          submitted_at      TEXT,
          submission_notes  TEXT,
          pinned_at         TEXT,
          retention_policy  TEXT    NOT NULL DEFAULT 'default',
          expires_at        TEXT,
          purged_at         TEXT,
          created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_apps_status  ON applications(status);
        CREATE INDEX idx_apps_job_id  ON applications(job_id);
        CREATE INDEX idx_apps_user_id ON applications(user_id);

        CREATE TABLE application_events (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
          event_type     TEXT    NOT NULL,
          payload        TEXT,
          created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_app_events_app ON application_events(application_id);
      `);
    },
  },
  {
    id: 'applications_002_versions',
    up: (db) => {
      db.exec(`
        CREATE TABLE application_versions (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          application_id    INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
          version_no        INTEGER NOT NULL,
          resume_path       TEXT,
          cover_letter_path TEXT,
          resume_diff       TEXT,
          feedback          TEXT,
          model_used        TEXT,
          generation_notes  TEXT,
          is_current        INTEGER NOT NULL DEFAULT 0,
          prunable          INTEGER NOT NULL DEFAULT 0,
          created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
          UNIQUE(application_id, version_no)
        );

        CREATE INDEX idx_app_versions_app ON application_versions(application_id);
      `);
    },
  },
  {
    id: 'applications_003_saved_prompts',
    up: (db) => {
      db.exec(`
        CREATE TABLE saved_prompts (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    TEXT    NOT NULL,
          name       TEXT    NOT NULL,
          content    TEXT    NOT NULL,
          created_at TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, name)
        );
        CREATE INDEX idx_saved_prompts_user ON saved_prompts(user_id);
      `);
    },
  },
];
