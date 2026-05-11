import type { Request, Response } from 'express';
import { bus, type SseEvent } from './bus';
import { createLogger } from '../logger';

const log = createLogger('sse');
const HEARTBEAT_MS = 15_000;

export function sseHandler(req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable nginx buffering if it's ever in the path.
    'X-Accel-Buffering': 'no',
  });
  // Initial flush so the client sees the connection is open immediately.
  res.write(': connected\n\n');

  const write = (e: SseEvent) => {
    res.write(`event: ${e.event}\n`);
    res.write(`data: ${JSON.stringify(e.data)}\n\n`);
  };

  bus.on('event', write);

  const hb = setInterval(() => {
    bus.publish('heartbeat', { t: Date.now() });
  }, HEARTBEAT_MS);

  // Fire one immediately so a fresh subscriber gets something within the first
  // request cycle without waiting 15s.
  bus.publish('heartbeat', { t: Date.now(), initial: true });

  const cleanup = () => {
    clearInterval(hb);
    bus.off('event', write);
    log.debug('client disconnected');
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}
