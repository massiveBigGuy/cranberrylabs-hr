import type { Module, AppContext } from '../types';
import { migrations } from './migrations';
import { RetentionRepo } from './repo';
import { buildRetentionRouter } from './router';
import { nightlySweep } from './sweep';

export const retentionModule: Module = {
  name: 'retention',
  version: '1.0.0',
  migrations,
  workers: [],
  scheduledTasks: [],
  init: async (ctx: AppContext) => {
    const repo = new RetentionRepo(ctx.db);

    retentionModule.router = buildRetentionRouter(ctx, repo);

    // Nightly purge at 2:00 AM — offset from midnight to avoid competing with
    // any backup or maintenance windows that run on the hour.
    retentionModule.scheduledTasks!.push({
      name: 'retention:nightly-sweep',
      cron: '0 2 * * *',
      task: async (c) => {
        await nightlySweep(c, repo);
      },
    });

    ctx.logger.debug('retention module initialized');
  },
};
