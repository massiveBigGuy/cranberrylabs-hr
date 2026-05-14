import type { Router } from 'express';
import type { Migration } from '../services/db/migrations';
import type { DB } from '../services/db';
import type { AppConfig } from '../config';
import type { Logger } from '../services/logger';
import type { Worker } from 'bullmq';
import type { ServiceRegistry } from './services-registry';

/**
 * Worker registration. The module constructs its own BullMQ Worker — that
 * gives the module full control over options, custom event listeners, and
 * naming — and hands the loader a factory that builds it. The loader keeps
 * a reference for graceful shutdown.
 *
 * Why a factory and not the Worker directly: workers need the AppContext
 * (db, config) to do anything useful, and that isn't available at module
 * definition time. The factory runs at registration time with ctx in scope.
 */
export interface WorkerRegistration {
  queueName: string;
  build: (ctx: AppContext) => Worker;
}

/**
 * Cron task registration. The task function is called on each cron tick.
 * Errors thrown by the task are logged but don't crash the scheduler.
 */
export interface CronTask {
  name: string;
  cron: string;             // e.g. '0 7 * * *'
  task: (ctx: AppContext) => Promise<void>;
}

/**
 * AppContext is handed to every module's `init` hook and to worker/cron
 * builders. Lets modules grab the DB, config, and a scoped logger without
 * reaching into globals.
 *
 * `services` is a small cross-module registry — used when one module
 * (e.g. sources router) needs a handle owned by another (e.g. scraper
 * queue). See modules/services-registry.ts.
 */
export interface AppContext {
  db: DB;
  config: AppConfig;
  logger: Logger;
  services: ServiceRegistry;
}

/**
 * Module contract — per §2 of the schema. The fields are exactly as specified;
 * `init` is async so a module can perform setup work (e.g. priming caches,
 * seeding defaults) before its router starts serving requests.
 */
export interface Module {
  name: string;
  version: string;
  /**
   * Optional. Modules that exist only for workers/cron/migrations can omit
   * this — the loader skips mounting when absent. Modules that build their
   * router in `init` (because it needs ctx) should assign it during init
   * and leave the field undefined at module-construction time.
   */
  router?: Router;
  migrations?: Migration[];
  workers?: WorkerRegistration[];
  scheduledTasks?: CronTask[];
  init?: (ctx: AppContext) => Promise<void>;
}
