import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../types';
import type { RetentionRepo } from './repo';

export async function nightlySweep(ctx: AppContext, repo: RetentionRepo): Promise<void> {
  const run = repo.startRun();
  let scanned = 0;
  let purged = 0;
  const skipped = 0;

  try {
    const candidates = repo.findPurgeCandidates();
    scanned = candidates.length;
    const storageRoot = path.resolve(ctx.config.storage.root);

    for (const app of candidates) {
      const appDir = path.resolve(storageRoot, String(app.id));
      if (fs.existsSync(appDir)) {
        fs.rmSync(appDir, { recursive: true, force: true });
      }

      repo.recordEvent({
        application_id: app.id,
        job_title: app.job_title,
        company: app.job_company,
        action: 'purged',
        reason: 'ttl_expired',
      });

      ctx.db.prepare('DELETE FROM applications WHERE id = ?').run(app.id);

      // Mirror what the DELETE /api/applications/:id handler does for job status.
      // Applied jobs keep their status — the fact they were applied is worth preserving.
      ctx.db
        .prepare(
          `UPDATE jobs SET status = 'reviewing'
           WHERE id = ? AND status IN ('queued', 'generating', 'ready')`,
        )
        .run(app.job_id);

      purged++;
    }

    repo.finishRun(run.id, {
      apps_scanned: scanned,
      apps_purged: purged,
      apps_skipped_pinned: skipped,
      status: 'ok',
    });
    ctx.logger.info('retention: sweep complete', { scanned, purged, skipped });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    repo.finishRun(run.id, {
      apps_scanned: scanned,
      apps_purged: purged,
      apps_skipped_pinned: skipped,
      status: 'error',
      error_message: msg,
    });
    ctx.logger.error('retention: sweep failed', { error: msg });
    throw err;
  }
}
