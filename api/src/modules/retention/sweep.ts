import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../types';
import type { RetentionRepo } from './repo';

function pruneVersionFiles(ctx: AppContext, storageRoot: string): number {
  // Find prunable version rows that still have file paths on disk.
  // We prune old version files for ALL applications (pinned or not) since
  // only the current version's files are needed; old version rows are kept
  // for audit/history.
  const prunable = ctx.db
    .prepare(
      `SELECT id, cover_letter_path, resume_path
       FROM application_versions
       WHERE prunable = 1 AND (cover_letter_path IS NOT NULL OR resume_path IS NOT NULL)`,
    )
    .all() as Array<{
    id: number;
    cover_letter_path: string | null;
    resume_path: string | null;
  }>;

  let filesPruned = 0;
  for (const v of prunable) {
    if (v.cover_letter_path) {
      const p = path.resolve(storageRoot, v.cover_letter_path);
      if (fs.existsSync(p)) {
        fs.rmSync(p, { force: true });
        filesPruned++;
      }
    }
    if (v.resume_path) {
      const p = path.resolve(storageRoot, v.resume_path);
      if (fs.existsSync(p)) {
        fs.rmSync(p, { force: true });
        filesPruned++;
      }
    }
    ctx.db
      .prepare(
        `UPDATE application_versions SET cover_letter_path = NULL, resume_path = NULL WHERE id = ?`,
      )
      .run(v.id);
  }
  return filesPruned;
}

export async function nightlySweep(ctx: AppContext, repo: RetentionRepo): Promise<void> {
  const run = repo.startRun();
  let scanned = 0;
  let purged = 0;

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

    // Prune individual version files for old versions of surviving applications.
    const filesPruned = pruneVersionFiles(ctx, storageRoot);

    repo.finishRun(run.id, {
      apps_scanned: scanned,
      apps_purged: purged,
      apps_skipped_pinned: 0,
      status: 'ok',
    });
    ctx.logger.info('retention: sweep complete', { scanned, purged, filesPruned });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    repo.finishRun(run.id, {
      apps_scanned: scanned,
      apps_purged: purged,
      apps_skipped_pinned: 0,
      status: 'error',
      error_message: msg,
    });
    ctx.logger.error('retention: sweep failed', { error: msg });
    throw err;
  }
}
