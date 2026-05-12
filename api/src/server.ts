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
  const spaDir = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(spaDir)) {
    log.info('serving SPA', { path: spaDir });
    app.use(express.static(spaDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(spaDir, 'index.html'));
    });
  } else {
    log.info('no SPA build found; serving placeholder', { expected: spaDir });
    app.get('/', (_req, res) => {
      res
        .type('text/plain')
        .send(
          'cranberrylabs-hr is running. The SPA has not been built yet.\n' +
            'API is available under /api/*.\n',
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
