import type { Migration } from '../../services/db/migrations';

/**
 * Migrations owned by the `sources` module. ID convention: `{module}_{nnn}_{slug}`.
 * Globally unique across the registry — see services/db/migrations.ts.
 *
 * Schema reference: §3 of docs/schema.md — the `sources` table.
 */
export const migrations: Migration[] = [
  {
    id: 'sources_001_init',
    up: (db) => {
      db.exec(`
        CREATE TABLE sources (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          company_name    TEXT    NOT NULL,
          platform        TEXT    NOT NULL,        -- 'workday' | 'greenhouse' | 'lever' | 'icims' | 'custom'
          tenant_url      TEXT    NOT NULL UNIQUE,
          search_params   TEXT,                    -- JSON: { keywords: [...], locations: [...] }
          enabled         INTEGER NOT NULL DEFAULT 1,
          last_scraped_at TEXT,
          last_status     TEXT,                    -- 'ok' | 'error' | 'blocked'
          last_error      TEXT,
          created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    id: 'sources_002_user_id',
    up: (db) => {
      // Scope sources to their owners. DEFAULT '' so existing rows get a
      // placeholder that the users module init backfills on first boot.
      db.exec(`ALTER TABLE sources ADD COLUMN user_id TEXT NOT NULL DEFAULT '';`);
    },
  },
];
