import type { Migration } from '../../services/db/migrations';

/**
 * Migrations owned by the scraper module.
 *
 * NOTE: this file already exists from step 2 with scraper_001_jobs and
 * scraper_002_scrape_runs. Step 3.1 ADDS scraper_003 to the END of the
 * array. Do not reorder — migrations run in array order and the runner
 * tracks applied IDs in schema_migrations, so appending is safe and the
 * existing two will be skipped as already-applied.
 *
 * Paste the scraper_003 object below into your existing migrations
 * array as the last element. The two existing migrations are shown
 * truncated for context only — keep your real versions.
 */
export const migrations: Migration[] = [
  // { id: 'scraper_001_jobs', up: (db) => { ... } },          // EXISTING — keep as-is
  // { id: 'scraper_002_scrape_runs', up: (db) => { ... } },   // EXISTING — keep as-is

  {
    id: 'scraper_003_detail_fetch_tracking',
    up: (db) => {
      // Track detail-fetch attempts per job so the hourly sweep can give
      // up on permanently-failing URLs instead of retrying forever.
      //
      // detail_fetch_status:
      //   'pending'  — not yet fetched, sweep should try (default)
      //   'ok'       — description successfully fetched
      //   'gave_up'  — exceeded the attempt threshold, sweep skips it
      //
      // Why a status column AND a counter: the counter drives the
      // give-up decision; the status makes the candidate query fast
      // (indexed equality check) and the UI state explicit.
      db.exec(`
        ALTER TABLE jobs ADD COLUMN detail_fetch_attempts INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE jobs ADD COLUMN detail_fetch_status TEXT NOT NULL DEFAULT 'pending';
      `);

      // Backfill: any job that already has a non-empty description is
      // 'ok'; everything else stays 'pending'. Without this, every
      // already-fetched job from the last week would look unfetched.
      db.exec(`
        UPDATE jobs SET detail_fetch_status = 'ok'
        WHERE description IS NOT NULL AND description != '';
      `);

      // Index supports the sweep's candidate query, which filters on
      // this column every hour.
      db.exec(`CREATE INDEX idx_jobs_detail_fetch ON jobs(detail_fetch_status);`);
    },
  },
  {
    id: 'scraper_004_user_id',
    up: (db) => {
      // Add user_id to jobs — inherited from the source that discovered them.
      // DEFAULT '' is backfilled by the users module init on first boot.
      db.exec(`ALTER TABLE jobs ADD COLUMN user_id TEXT NOT NULL DEFAULT '';`);
    },
  },
];
