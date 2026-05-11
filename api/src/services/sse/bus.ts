import { EventEmitter } from 'node:events';

/**
 * Event names emitted on the SSE bus. Listed per §4 of the schema, plus a
 * heartbeat used to keep the connection alive through proxies.
 */
export type SseEventName =
  | 'heartbeat'
  | 'scrape.started'
  | 'scrape.completed'
  | 'job.discovered'
  | 'application.queued'
  | 'application.started'
  | 'application.ready'
  | 'application.failed'
  | 'queue.progress'
  | 'queue.drained';

export interface SseEvent<T = unknown> {
  event: SseEventName;
  data: T;
}

class SseBus extends EventEmitter {
  publish<T>(event: SseEventName, data: T): void {
    this.emit('event', { event, data } satisfies SseEvent<T>);
  }
}

// Singleton — modules import this and call `bus.publish(...)`.
export const bus = new SseBus();

// Don't crash if there are no subscribers; the bus is always-on regardless of
// whether the dashboard is open.
bus.setMaxListeners(50);
