import type { Module, AppContext } from '../types';
import { migrations } from './migrations';
import { buildProfilesRouter } from './router';

export const profilesModule: Module = {
  name: 'profiles',
  version: '0.1.0',
  migrations,
  init: async (ctx: AppContext) => {
    await seedDefaultProfiles(ctx);
    profilesModule.router = buildProfilesRouter(ctx);
    ctx.logger.debug('profiles module initialized');
  },
};

/**
 * On first boot after the 7.2 migration, create a default profile for every
 * known user and backfill sources.profile_id / writing_samples.profile_id.
 * Idempotent: re-running on an already-seeded DB is a no-op.
 *
 * Keyword sets are seeded from scraper.filters config — the same values that
 * were used for scoring before 7.2. After this migration runs, the live filter
 * lives on the profile row and can be edited via the API without touching config.
 */
async function seedDefaultProfiles(ctx: AppContext): Promise<void> {
  const { db, config, logger } = ctx;

  const userRows = db
    .prepare(
      `SELECT DISTINCT user_id FROM (
         SELECT user_id FROM sources       WHERE user_id != ''
         UNION
         SELECT user_id FROM master_resume WHERE user_id != ''
         UNION
         SELECT user_id FROM writing_samples WHERE user_id != ''
       )`,
    )
    .all() as { user_id: string }[];

  if (userRows.length === 0) return;

  const targetKws: string[] = config.scraper?.filters?.target_keywords ?? [];
  const excludedKws: string[] = config.scraper?.filters?.excluded_keywords ?? [];

  for (const { user_id } of userRows) {
    const alreadyHasDefault = db
      .prepare('SELECT id FROM profiles WHERE user_id = ? AND is_default = 1')
      .get(user_id) as { id: number } | undefined;

    if (!alreadyHasDefault) {
      const activeResume = db
        .prepare('SELECT id FROM master_resume WHERE is_active = 1 AND user_id = ?')
        .get(user_id) as { id: number } | undefined;

      // ON CONFLICT handles the edge case of "Default" name already existing
      // (e.g. user manually created one) — in that case promote it to default.
      db.prepare(
        `INSERT INTO profiles (user_id, name, target_keywords, excluded_keywords, resume_version_id, is_default)
         VALUES (?, 'Default', ?, ?, ?, 1)
         ON CONFLICT(user_id, name) DO UPDATE SET
           is_default = 1,
           updated_at = datetime('now')`,
      ).run(
        user_id,
        targetKws.length > 0 ? JSON.stringify(targetKws) : null,
        excludedKws.length > 0 ? JSON.stringify(excludedKws) : null,
        activeResume?.id ?? null,
      );

      logger.info('profiles: created default profile', { user_id });
    }

    const defaultProfile = db
      .prepare('SELECT id FROM profiles WHERE user_id = ? AND is_default = 1')
      .get(user_id) as { id: number } | undefined;

    if (!defaultProfile) continue;

    const srcChanges = db
      .prepare('UPDATE sources SET profile_id = ? WHERE user_id = ? AND profile_id IS NULL')
      .run(defaultProfile.id, user_id).changes;
    if (srcChanges > 0) {
      logger.info('profiles: backfilled sources.profile_id', { user_id, rows: srcChanges });
    }

    const sampleChanges = db
      .prepare(
        'UPDATE writing_samples SET profile_id = ? WHERE user_id = ? AND profile_id IS NULL',
      )
      .run(defaultProfile.id, user_id).changes;
    if (sampleChanges > 0) {
      logger.info('profiles: backfilled writing_samples.profile_id', {
        user_id,
        rows: sampleChanges,
      });
    }
  }
}
