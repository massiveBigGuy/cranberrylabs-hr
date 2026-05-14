/**
 * The single source of truth for which modules are mounted. Adding a new
 * module is one import + one entry in this array — per §2 of the schema, "a
 * matter of dropping a new folder into src/modules/ and adding one line to
 * the registry".
 *
 * ORDER MATTERS for migrations: a module's migrations run in the order its
 * module appears here. The `jobs` table (scraper module) has a FK on
 * `sources(id)`, so sources must come before scraper.
 */
import type { Module } from './types';
import { sourcesModule } from './sources';
import { scraperModule } from './scraper';

export const modules: Module[] = [
  sourcesModule,
  scraperModule,
  // Future, added in their respective build-order steps:
  //   jobsModule,           — step 3
  //   resumeModule,         — step 5
  //   applicationsModule,   — step 6
  //   notificationsModule,  — step 9
  //   retentionModule,      — step 10
];
