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
  {
    id: 'profiles_002_location_filter',
    up: (db) => {
      // allowed_countries/allowed_states null = no restriction (allow all).
      // include_remote/include_null_location default to 1 so no existing
      // job is newly excluded until the user configures the filter.
      db.exec(`
        ALTER TABLE profiles ADD COLUMN allowed_countries TEXT;
        ALTER TABLE profiles ADD COLUMN allowed_states TEXT;
        ALTER TABLE profiles ADD COLUMN include_remote INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE profiles ADD COLUMN include_null_location INTEGER NOT NULL DEFAULT 1;
      `);
    },
  },
];
