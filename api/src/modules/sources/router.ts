import { Router } from 'express';

/**
 * Routes from §4 of the schema:
 *
 *   GET    /api/sources
 *   POST   /api/sources
 *   GET    /api/sources/:id
 *   PATCH  /api/sources/:id
 *   DELETE /api/sources/:id
 *   POST   /api/sources/:id/scrape
 *   GET    /api/sources/:id/runs
 *
 * Stubbed to 501 in step 1 — the module's purpose right now is to prove the
 * loader/migrations/router contract end-to-end. Real handlers land in
 * build-order step 2 once the scraper module exists to back them.
 */
export const router: Router = Router();

router.get('/', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', step: 'build-order step 2' });
});

router.post('/', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', step: 'build-order step 2' });
});

router.get('/:id', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', step: 'build-order step 2' });
});

router.patch('/:id', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', step: 'build-order step 2' });
});

router.delete('/:id', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', step: 'build-order step 2' });
});

router.post('/:id/scrape', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', step: 'build-order step 2' });
});

router.get('/:id/runs', (_req, res) => {
  res.status(501).json({ error: 'not_implemented', step: 'build-order step 2' });
});
