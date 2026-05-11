import type { Router } from 'express';
import type { Migration } from '../services/db/migrations';
import type { DB } from '../services/db';
import type { AppConfig } from '../config';
import type { Logger } from '../services/logger';

/**
 * Worker registration. The queue service (added in build-order step 7) will
 * read these and wire them up to BullMQ. For now this is just a shape — no
 * module declares workers yet.
 */
export interface WorkerDefinition {
  queueName: string;
  processor: (job: unknown) => Promise<unknown>;
  concurrency?: number;
}

/**
 * Cron task registration. Scheduler picks these up at startup; per-module
 * scheduling decouples the registry from `node-cron` directly.
 */
export interface CronTask {
  name: string;
  cron: string;             // e.g. '0 7 * * *'
  task: () => Promise<void>;
}

/**
 * AppContext is handed to every module's `init` hook. Lets modules grab the
 * DB, config, and a scoped logger without reaching into globals.
 */
export interface AppContext {
  db: DB;
  config: AppConfig;
  logger: Logger;
}

/**
 * Module contract — per §2 of the schema. The fields are exactly as specified;
 * `init` is async so a module can perform setup work (e.g. priming caches,
 * seeding defaults) before its router starts serving requests.
 */
export interface Module {
  name: string;
  version: string;
  router: Router;
  migrations?: Migration[];
  workers?: WorkerDefinition[];
  scheduledTasks?: CronTask[];
  init?: (ctx: AppContext) => Promise<void>;
}
