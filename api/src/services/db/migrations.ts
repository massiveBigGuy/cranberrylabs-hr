import type { DB } from './index';
import { createLogger } from '../logger';

const log = createLogger('migrations');

/**
 * A single migration owned by a module. `id` must be globally unique across
 * all modules — the module prefix convention (`sources_001_init`) handles this
 * without needing a separate `module` column.
 *
 * `up` receives the open DB handle. Transactions are managed by the runner.
 */
export interface Migration {
  id: string;
  up: (db: DB) => void;
}

const MIGRATIONS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id          TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

function ensureTrackingTable(db: DB): void {
  db.exec(MIGRATIONS_TABLE_DDL);
}

function isApplied(db: DB, id: string): boolean {
  const row = db
    .prepare('SELECT 1 AS one FROM schema_migrations WHERE id = ?')
    .get(id) as { one: number } | undefined;
  return !!row;
}

function markApplied(db: DB, id: string): void {
  db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(id);
}

/**
 * Run a batch of migrations. Each migration runs inside its own transaction so
 * a failure halfway through a multi-statement migration rolls back cleanly.
 * Skips any migration whose id is already in `schema_migrations`.
 */
export function runMigrations(db: DB, migrations: Migration[]): void {
  ensureTrackingTable(db);

  for (const m of migrations) {
    if (isApplied(db, m.id)) {
      log.debug('skip (already applied)', { id: m.id });
      continue;
    }
    log.info('applying', { id: m.id });
    const tx = db.transaction(() => {
      m.up(db);
      markApplied(db, m.id);
    });
    try {
      tx();
    } catch (err) {
      log.error('migration failed', { id: m.id, error: (err as Error).message });
      throw err;
    }
  }
}
