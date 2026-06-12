import type { Migration } from '../../services/db/migrations';

export const migrations: Migration[] = [
  {
    id: 'retention_001_tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE retention_policies (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          name            TEXT    NOT NULL UNIQUE,
          description     TEXT,
          ttl_days        INTEGER,
          is_default      INTEGER NOT NULL DEFAULT 0,
          created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE retention_runs (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          started_at          TEXT    NOT NULL DEFAULT (datetime('now')),
          finished_at         TEXT,
          apps_scanned        INTEGER DEFAULT 0,
          apps_purged         INTEGER DEFAULT 0,
          apps_skipped_pinned INTEGER DEFAULT 0,
          status              TEXT,
          error_message       TEXT
        );

        CREATE TABLE retention_events (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          application_id  INTEGER NOT NULL,
          job_title       TEXT,
          company         TEXT,
          action          TEXT    NOT NULL,
          reason          TEXT,
          created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_retention_events_app ON retention_events(application_id);

        INSERT INTO retention_policies (name, description, ttl_days, is_default)
        VALUES ('default', '7 days unless pinned', 7, 1);

        INSERT INTO retention_policies (name, description, ttl_days)
        VALUES ('keep-30d', 'Retain for 30 days', 30);

        INSERT INTO retention_policies (name, description, ttl_days)
        VALUES ('forever', 'Never auto-purge', NULL);
      `);
    },
  },
];
