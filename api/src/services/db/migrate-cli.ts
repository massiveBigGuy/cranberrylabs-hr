/**
 * Standalone migration runner. Walks the module registry, collects every
 * migration, and applies them. Intended for use in CI / pre-deploy hooks where
 * you want migrations to run separately from server startup.
 *
 *   npm run migrate
 */
import { loadConfig } from '../../config';
import { openDatabase, closeDatabase } from './index';
import { runMigrations } from './migrations';
import { modules } from '../../modules/registry';
import { createLogger } from '../logger';

const log = createLogger('migrate-cli');

function main() {
  const config = loadConfig();
  const db = openDatabase(config.database.path);

  const all = modules.flatMap((m) => m.migrations ?? []);
  log.info('collected migrations', { count: all.length, modules: modules.map((m) => m.name) });

  runMigrations(db, all);
  closeDatabase();
  log.info('done');
}

main();
