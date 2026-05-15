import type { Migration } from '../../services/db/migrations';

/**
 * Migrations owned by the `jobs` module.
 *
 * Note on scope: the `jobs` table itself is owned by the scraper module
 * (it was created in build-order step 2, migration scraper_001_jobs).
 * The jobs module owns higher-level operations on that table plus the
 * tag tables, since tagging is a feature of the jobs UI rather than the
 * scraper.
 *
 * Build-order note: the schema (§10) lists tag work in step 11, but we
 * land the tables now per resolved scope — see UPGRADE-step3.md. The
 * tables are additive (FK only to jobs(id)) and don't risk breaking
 * future work; deferring would only mean another migration later.
 */
export const migrations: Migration[] = [
  {
    id: 'jobs_001_tags',
    up: (db) => {
      db.exec(`
        CREATE TABLE tags (
          id    INTEGER PRIMARY KEY AUTOINCREMENT,
          name  TEXT    NOT NULL UNIQUE,
          color TEXT
        );
        CREATE INDEX idx_tags_name ON tags(name);
      `);
    },
  },
  {
    id: 'jobs_002_job_tags',
    up: (db) => {
      db.exec(`
        CREATE TABLE job_tags (
          job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (job_id, tag_id)
        );
        CREATE INDEX idx_job_tags_tag ON job_tags(tag_id);
      `);
    },
  },
];
