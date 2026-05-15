import { Router } from 'express';
import type { AppContext } from '../types';

/**
 * Scraper module router.
 *
 * History:
 *   - Step 2 exposed GET /api/scraper/jobs and /api/scraper/jobs/:id as
 *     diagnostic endpoints, because the jobs module didn't exist yet.
 *   - Step 3 (this revision) removes those: GET /api/jobs and
 *     GET /api/jobs/:id now serve the same data with proper filtering,
 *     pagination, and tag joining. Keeping the diagnostic versions
 *     around would create two ways to do the same thing and is the
 *     kind of duplication that drifts out of sync.
 *
 * The router survives as an empty mount point. Future scraper-specific
 * operational endpoints can land here without re-plumbing the loader —
 * for example, a future /api/scraper/runs aggregate view that's not
 * tied to a single source.
 */
export function buildScraperRouter(_ctx: AppContext): Router {
  const router = Router();

  // Intentionally empty for now. Scrape operations live on the sources
  // router: POST /api/sources/:id/scrape, /test, GET /:id/runs.

  return router;
}
