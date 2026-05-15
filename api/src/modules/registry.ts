/**
 * The single source of truth for which modules are mounted. Adding a new
 * module is one import + one entry in this array — per §2 of the schema, "a
 * matter of dropping a new folder into src/modules/ and adding one line to
 * the registry".
 *
 * ORDER MATTERS for migrations: a module's migrations run in the order its
 * module appears here.
 *   - sources owns the `sources` table
 *   - scraper owns `jobs` (FK on sources) and `scrape_runs`
 *   - jobs owns `tags` and `job_tags` (FK on jobs)
 *
 * So: sources → scraper → jobs.
 */
import type { Module } from './types';
import { sourcesModule } from './sources';
import { scraperModule } from './scraper';
import { jobsModule } from './jobs';

export const modules: Module[] = [
  sourcesModule,
  scraperModule,
  jobsModule,
  // Future, added in their respective build-order steps:
  //   resumeModule,         — step 5
  //   applicationsModule,   — step 6
  //   notificationsModule,  — step 9
  //   retentionModule,      — step 10
];
