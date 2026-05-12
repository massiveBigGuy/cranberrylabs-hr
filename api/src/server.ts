import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { loadConfig } from './config';
import { openDatabase, closeDatabase } from './services/db';
import { createLogger } from './services/logger';
import { sseHandler } from './services/sse/handler';
import { makeAutheliaIdentity } from './middleware/authelia';
import { loadModules } from './modules/loader';
import type { AppContext } from './modules/types';

const log = createLogger('server');

async function main() {
  const config = loadConfig();
  const db = openDatabase(config.database.path);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Liveness probe — placed before auth so the reverse proxy can health-check
  // without forwarding through Authelia. Returns no sensitive info.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Auth middleware applies to everything under /api. SSE included — the
  // dashboard subscribes after the user has authenticated.
  app.use('/api', makeAutheliaIdentity(config));

  // SSE endpoint per §4. Heartbeats prove the pipe is live even before any
  // module emits domain events.
  app.get('/api/events', sseHandler);

  // Module mounting.
  const ctx: AppContext = {
    db,
    config,
    logger: createLogger('module'),
  };
  await loadModules(app, ctx);

  // SPA serving. The web/ workspace builds into web/dist/ — once it exists,
  // serve it as static assets and fall back to index.html for any non-/api/*
  // path so client-side routing works. Until the SPA is built, expose a
  // human-readable placeholder at / so hitting the bare domain in a browser
  // doesn't 404 confusingly.
  //
  // Path resolution: in dev (tsx) __dirname is api/src/. In prod (compiled)
  // it's api/dist/. Either way, web/dist is two levels up + web/dist.
  //
  // The existence check looks for index.html specifically rather than the
  // directory, because the Dockerfile pre-creates an empty web/dist/ so the
  // build doesn't need a conditional COPY. An empty dir would fool a
  // directory-only check and route requests to a non-existent index.html.
  const spaIndex = path.resolve(__dirname, '../../web/dist/index.html');
  const spaDir = path.dirname(spaIndex);
  if (fs.existsSync(spaIndex)) {
    log.info('serving SPA', { path: spaDir });
    app.use(express.static(spaDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(spaIndex);
    });
  } else {
    log.info('no SPA build found; serving placeholder', { expected: spaIndex });
    // HTML rather than text/plain so browsers render this as a page (not as
    // a downloadable file or — in Firefox's case — passed through the JSON
    // viewer extension, which sandboxes the page under its own restrictive
    // CSP and confuses dev-tools debugging).
    app.get('/', (_req, res) => {
      res.type('text/html').send(
        `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>cranberrylabs-hr</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; color: #ddd; background: #1a1a1a; }
      code { background: #2a2a2a; padding: 0.1em 0.3em; border-radius: 3px; }
      a { color: #6cf; }
    </style>
  </head>
  <body>
    <h1>cranberrylabs-hr</h1>
    <p>The API is running. The SPA has not been built yet — that's build-order step 3.</p>
    <p>API endpoints are available under <code>/api/*</code>.</p>
    <p>Liveness probe: <a href="/health">/health</a></p>
  </body>
</html>
`,
      );
    });
  }

  // Last-resort error handler — keeps an unhandled exception from killing the
  // response stream and leaving the client hanging.
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      log.error('unhandled error', { message: err.message, stack: err.stack });
      if (!res.headersSent) {
        res.status(500).json({ error: 'internal_error' });
      }
    },
  );

  const server = app.listen(config.server.port, config.server.host, () => {
    log.info('listening', { host: config.server.host, port: config.server.port });
  });

  const shutdown = (signal: string) => {
    log.info('shutdown', { signal });
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
    // Force exit if close hangs (long-lived SSE connections, mostly).
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('startup failed', { message: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
