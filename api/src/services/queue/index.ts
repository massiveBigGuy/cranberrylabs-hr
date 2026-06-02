/**
 * Centralized Redis connection + BullMQ queue helpers.
 *
 * BullMQ requires every queue and every worker to have its own ioredis client
 * instance (sharing one across both has caused subtle bugs in BullMQ's
 * lifecycle since 4.x). This module returns *new* connections per call so
 * callers can keep their own client.
 */
import { Queue, Worker, type WorkerOptions, type QueueOptions, type Processor } from 'bullmq';
import type { AppConfig } from '../../config';
import { createLogger } from '../logger';

const log = createLogger('queue');

// BullMQ v5 bundles its own ioredis internally. Passing a plain options object
// (rather than an ioredis instance from the top-level package) avoids the
// dual-ioredis type conflict and lets BullMQ create its own client.
function makeConnectionOpts(config: AppConfig) {
  return {
    url: config.queue.redis_url,
    maxRetriesPerRequest: null as null,
    enableReadyCheck: false,
  };
}

/**
 * Build a Queue. Caller owns the returned instance and must close() it on
 * shutdown to flush in-flight commands.
 */
export function makeQueue<T = unknown>(
  name: string,
  config: AppConfig,
  options?: Partial<QueueOptions>,
): Queue<T> {
  return new Queue<T>(name, {
    connection: makeConnectionOpts(config),
    defaultJobOptions: {
      attempts: config.queue.retry_attempts,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
    ...options,
  });
}

/**
 * Build a Worker. The processor function is called for each job; it should
 * throw on failure (BullMQ uses thrown errors as the retry signal).
 */
export function makeWorker<T = unknown, R = unknown>(
  name: string,
  processor: Processor<T, R>,
  config: AppConfig,
  options?: Partial<WorkerOptions>,
): Worker<T, R> {
  const worker = new Worker<T, R>(name, processor, {
    connection: makeConnectionOpts(config),
    concurrency: config.queue.concurrency,
    ...options,
  });
  worker.on('failed', (job, err) => {
    log.warn('job failed', { queue: name, jobId: job?.id, error: err.message });
  });
  worker.on('error', (err) => {
    log.error('worker error', { queue: name, message: err.message });
  });
  return worker;
}
