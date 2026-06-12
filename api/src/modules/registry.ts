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
 *
 * profiles must come AFTER resume (resume_004_profile_id must exist before
 * profiles' init backfills writing_samples.profile_id), and AFTER sources
 * (sources_003_profile_id must exist before profiles' init backfills
 * sources.profile_id). SQLite validates FK constraints at DML time, not DDL
 * time, so sources_003 can reference profiles(id) before profiles_001_init
 * runs — the column is added as NULL and never populated until profiles' init.
 */
import type { Module } from './types';
import { sourcesModule } from './sources';
import { scraperModule } from './scraper';
import { jobsModule } from './jobs';
import { resumeModule } from './resume';
import { profilesModule } from './profiles';
import { applicationsModule } from './applications';
import { notificationsModule } from './notifications';
import { retentionModule } from './retention';
import { usersModule } from './users';

export const modules: Module[] = [
  sourcesModule,
  scraperModule,
  jobsModule,
  resumeModule,
  profilesModule,       // after resume (needs resume_004) + sources (needs sources_003)
  applicationsModule,
  notificationsModule,  // subscribes to bus events published by the applications worker
  retentionModule,      // TTL policies, pin/unpin, nightly sweep
  usersModule,          // last: seeds admin + backfills user_id after all other migrations
];
