import type { Module, AppContext } from '../types';
import { Router } from 'express';
import { migrations } from './migrations';
import { buildUsersRouter } from './router';

export const usersModule: Module = {
  name: 'users',
  version: '0.1.0',
  router: Router(),
  migrations,
  init: async (ctx: AppContext) => {
    // Admin seeding: prefer explicit config; fall back to dev_bypass_user so
    // local dev works without a separate users.initial_admin setting.
    const adminUsername =
      ctx.config.users?.initial_admin ?? ctx.config.auth.dev_bypass_user ?? null;

    if (adminUsername) {
      ctx.db
        .prepare(
          `INSERT INTO users (username, role) VALUES (?, 'admin')
           ON CONFLICT(username) DO NOTHING`,
        )
        .run(adminUsername);

      // Backfill user_id = '' rows created by the 7.1 migrations before this
      // init ran. After first boot every owned row has a real username.
      for (const table of ['sources', 'jobs', 'master_resume', 'writing_samples']) {
        const n = ctx.db
          .prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ''`)
          .run(adminUsername).changes;
        if (n > 0) {
          ctx.logger.info('users: backfilled user_id', { table, rows: n, username: adminUsername });
        }
      }
    }

    usersModule.router = buildUsersRouter(ctx);
    ctx.logger.debug('users module initialized');
  },
};
