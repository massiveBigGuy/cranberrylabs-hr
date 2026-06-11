import type { Migration } from '../../services/db/migrations';

export const migrations: Migration[] = [
  {
    id: 'profiles_001_init',
    up: (db) => {
      db.exec(`
        CREATE TABLE profiles (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id           TEXT    NOT NULL,
          name              TEXT    NOT NULL,
          target_keywords   TEXT,
          excluded_keywords TEXT,
          resume_version_id INTEGER REFERENCES master_resume(id),
          is_default        INTEGER NOT NULL DEFAULT 0,
          created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, name)
        );
        CREATE INDEX idx_profiles_user ON profiles(user_id);
      `);
    },
  },
];
