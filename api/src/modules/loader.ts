import type { Express } from 'express';
import type { AppContext, Module, WorkerDefinition, CronTask } from './types';
import { modules } from './registry';
import { runMigrations } from '../services/db/migrations';
import { createLogger } from '../services/logger';

const log = createLogger('module-loader');

/**
 * Stubs for worker/cron registration. The actual queue service (build-order
 * step 7) and scheduler will replace these. Keeping them as no-op functions
 * means modules can already declare `workers` and `scheduledTasks` without
 * the loader crashing.
 */
function registerWorker(w: WorkerDefinition): void {
  log.info('worker registration deferred', { queue: w.queueName });
  // TODO(step 7): wire to BullMQ via services/queue
}

function scheduleTask(t: CronTask): void {
  log.info('cron registration deferred', { name: t.name, cron: t.cron });
  // TODO(step 7): wire to node-cron via services/scheduler
}

/**
 * The schema's §2 pseudocode lists `init → migrations → workers → cron →
 * router`. In practice migrations must run first — `init` hooks legitimately
 * need to query/seed tables that the migrations create. Order chosen here:
 *
 *   1. migrations (create/alter tables)
 *   2. init       (seed defaults, prime caches)
 *   3. workers    (declare queue processors)
 *   4. cron       (declare scheduled tasks)
 *   5. router     (mount /api/{name})
 *
 * Mounting last means a module isn't reachable over HTTP until its setup
 * completes — fewer race conditions on a cold start.
 */
export async function loadModules(app: Express, ctx: AppContext): Promise<void> {
  log.info('loading modules', { count: modules.length });

  for (const mod of modules) {
    log.info('→ module', { name: mod.name, version: mod.version });

    if (mod.migrations?.length) {
      runMigrations(ctx.db, mod.migrations);
    }
    if (mod.init) {
      await mod.init(ctx);
    }
    mod.workers?.forEach(registerWorker);
    mod.scheduledTasks?.forEach(scheduleTask);

    app.use(`/api/${mod.name}`, mod.router);
    log.info('   mounted', { path: `/api/${mod.name}` });
  }

  log.info('all modules loaded');
}
