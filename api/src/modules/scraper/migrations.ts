import type { Migration } from '../../services/db/migrations';

/**
 * Migrations owned by the scraper module. Per §3 of the schema:
 *   - jobs              (with all status/fit columns and unique constraint)
 *   - scrape_runs       (observability for runs)
 *
 * Tag tables (tags, job_tags) are not created here — they're a later
 * concern (build-order step 11) and live in the jobs module when that
 * gets implemented.
 */
export const migrations: Migration[] = [
  {
    id: 'scraper_001_jobs',
    up: (db) => {
      db.exec(`
        CREATE TABLE jobs (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id       INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
          external_id     TEXT    NOT NULL,
          title           TEXT    NOT NULL,
          company         TEXT    NOT NULL,
          location        TEXT,
          remote_type     TEXT,
          url             TEXT    NOT NULL,
          description     TEXT    NOT NULL DEFAULT '',
          description_hash TEXT   NOT NULL DEFAULT '',
          posted_date     TEXT,
          discovered_at   TEXT    NOT NULL DEFAULT (datetime('now')),
          hiring_manager  TEXT,
          hiring_manager_source TEXT,
          salary_min      INTEGER,
          salary_max      INTEGER,
          salary_currency TEXT,
          fit_score       REAL,
          fit_reasons     TEXT,
          status          TEXT    NOT NULL DEFAULT 'new',
          dismissed_reason TEXT,
          UNIQUE(source_id, external_id)
        );
        CREATE INDEX idx_jobs_status ON jobs(status);
        CREATE INDEX idx_jobs_posted ON jobs(posted_date);
        CREATE INDEX idx_jobs_fit ON jobs(fit_score DESC);
        CREATE INDEX idx_jobs_source ON jobs(source_id);
      `);
    },
  },
  {
    id: 'scraper_002_scrape_runs',
    up: (db) => {
      db.exec(`
        CREATE TABLE scrape_runs (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
          started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
          finished_at   TEXT,
          status        TEXT    NOT NULL,
          jobs_found    INTEGER DEFAULT 0,
          jobs_new      INTEGER DEFAULT 0,
          error_message TEXT
        );
        CREATE INDEX idx_scrape_runs_source ON scrape_runs(source_id);
        CREATE INDEX idx_scrape_runs_started ON scrape_runs(started_at DESC);
      `);
    },
  },
];
