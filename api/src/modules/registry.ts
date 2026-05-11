/**
 * The single source of truth for which modules are mounted. Adding a new
 * module is one import + one entry in this array — per §2 of the schema, "a
 * matter of dropping a new folder into src/modules/ and adding one line to
 * the registry".
 */
import type { Module } from './types';
import { sourcesModule } from './sources';

export const modules: Module[] = [
  sourcesModule,
  // Future, added in their respective build-order steps:
  //   scraperModule,        — step 2
  //   jobsModule,           — step 3
  //   applicationsModule,   — step 6
  //   resumeModule,         — step 5
  //   retentionModule,      — step 10
  //   notificationsModule,  — step 9
];
