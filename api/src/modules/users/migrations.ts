import type { Migration } from '../../services/db/migrations';

export const migrations: Migration[] = [
  {
    id: 'users_001_init',
    up: (db) => {
      db.exec(`
        CREATE TABLE users (
          username     TEXT    PRIMARY KEY,
          email        TEXT,
          display_name TEXT,
          role         TEXT    NOT NULL DEFAULT 'user',
          created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
          last_seen_at TEXT
        );
      `);
    },
  },
];
