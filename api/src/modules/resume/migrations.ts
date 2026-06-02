import type { Migration } from '../../services/db/migrations';

export const migrations: Migration[] = [
  {
    id: 'resume_001_tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE master_resume (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          version     INTEGER NOT NULL,
          content     TEXT    NOT NULL,
          notes       TEXT,
          is_active   INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE writing_samples (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          label      TEXT    NOT NULL,
          kind       TEXT    NOT NULL,
          content    TEXT    NOT NULL,
          active     INTEGER NOT NULL DEFAULT 1,
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
];
