import type { Express } from 'express';
import type { Worker } from 'bullmq';
import cron from 'node-cron';
import type { AppContext, Module, WorkerRegistration, CronTask } from './types';
import { modules } from './registry';
import { runMigrations } from '../services/db/migrations';
import { createLogger } from '../services/logger';

const log = createLogger('module-loader');

/**
 * Handles returned to the server so it can gracefully tear everything down
 * on SIGTERM. Workers must be closed for BullMQ to flush in-flight jobs;
 * cron tasks must be stopped so they don't tick during shutdown.
 */
export interface LoadedModules {
  workers: Worker[];
  cronTasks: cron.ScheduledTask[];
  shutdown: () => Promise<void>;
}

/**
 * The schema's §2 pseudocode lists `init → migrations → workers → cron →
 * router`. In practice migrations must run first — `init` hooks legitimately
 * need to query/seed tables that the migrations create. Order chosen here:
 *
 *   1. migrations (create/alter tables)
 *   2. init       (seed defaults, prime caches)
 *   3. workers    (build BullMQ workers)
 *   4. cron       (schedule cron tasks)
 *   5. router     (mount /api/{name})
 *
 * Mounting last means a module isn't reachable over HTTP until its setup
 * completes — fewer race conditions on a cold start.
 */
export async function loadModules(app: Express, ctx: AppContext): Promise<LoadedModules> {
  log.info('loading modules', { count: modules.length });

  const workers: Worker[] = [];
  const cronTasks: cron.ScheduledTask[] = [];

  for (const mod of modules) {
    log.info('→ module', { name: mod.name, version: mod.version });

    if (mod.migrations?.length) {
      runMigrations(ctx.db, mod.migrations);
    }
    if (mod.init) {
      await mod.init(ctx);
    }
    mod.workers?.forEach((reg) => workers.push(registerWorker(reg, ctx)));
    mod.scheduledTasks?.forEach((task) => cronTasks.push(scheduleTask(task, ctx)));

    if (mod.router) {
      app.use(`/api/${mod.name}`, mod.router);
      log.info('   mounted', { path: `/api/${mod.name}` });
    } else {
      log.info('   no router (worker/cron-only module)');
    }
  }

  log.info('all modules loaded', { workers: workers.length, cronTasks: cronTasks.length });

  return {
    workers,
    cronTasks,
    shutdown: async () => {
      log.info('shutting down modules');
      // Stop cron first so no new work is scheduled while workers drain.
      for (const t of cronTasks) t.stop();
      // Then close workers; BullMQ awaits in-flight jobs before resolving.
      await Promise.all(workers.map((w) => w.close()));
      log.info('modules shut down');
    },
  };
}

function registerWorker(reg: WorkerRegistration, ctx: AppContext): Worker {
  log.info('   worker', { queue: reg.queueName });
  return reg.build(ctx);
}

function scheduleTask(t: CronTask, ctx: AppContext): cron.ScheduledTask {
  log.info('   cron', { name: t.name, schedule: t.cron });
  return cron.schedule(t.cron, async () => {
    try {
      await t.task(ctx);
    } catch (err) {
      log.error('cron task threw', {
        name: t.name,
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
    }
  });
}
