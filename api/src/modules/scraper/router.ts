import { Router } from 'express';
import type { AppContext } from '../types';
import type { DB } from '../../services/db';

/**
 * Scraper module router. Most user-facing scrape operations are owned by
 * the sources router (POST /api/sources/:id/scrape, POST /:id/test). The
 * scraper module's own router exposes a small diagnostic surface — useful
 * during step-2 development before the jobs module (build-order step 3)
 * provides the full UI for browsing what was scraped.
 */
export function buildScraperRouter(ctx: AppContext): Router {
  const router = Router();
  const db: DB = ctx.db;

  /**
   * GET /api/scraper/jobs — quick listing of recently discovered jobs.
   * The jobs module's router (step 3) will provide richer querying; this
   * is the bare-minimum view for verifying a scrape actually landed data.
   */
  router.get('/jobs', (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const sourceId = req.query.source_id ? Number(req.query.source_id) : null;
    const rows = sourceId
      ? db
          .prepare(
            `SELECT id, source_id, title, company, location, remote_type, url,
                    posted_date, discovered_at, status,
                    CASE WHEN description = '' THEN 0 ELSE 1 END AS has_description
             FROM jobs
             WHERE source_id = ?
             ORDER BY discovered_at DESC
             LIMIT ?`,
          )
          .all(sourceId, limit)
      : db
          .prepare(
            `SELECT id, source_id, title, company, location, remote_type, url,
                    posted_date, discovered_at, status,
                    CASE WHEN description = '' THEN 0 ELSE 1 END AS has_description
             FROM jobs
             ORDER BY discovered_at DESC
             LIMIT ?`,
          )
          .all(limit);
    res.json({ jobs: rows });
  });

  /**
   * GET /api/scraper/jobs/:id — single job detail including description.
   * Same diagnostic-only caveat as above.
   */
  router.get('/jobs/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ job: row });
  });

  return router;
}
