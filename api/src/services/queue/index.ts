/**
 * Centralized Redis connection + BullMQ queue helpers.
 *
 * BullMQ requires every queue and every worker to have its own ioredis client
 * instance (sharing one across both has caused subtle bugs in BullMQ's
 * lifecycle since 4.x). This module returns *new* connections per call so
 * callers can keep their own client.
 */
import IORedis, { type Redis } from 'ioredis';
import { Queue, Worker, type WorkerOptions, type QueueOptions, type Processor } from 'bullmq';
import type { AppConfig } from '../../config';
import { createLogger } from '../logger';

const log = createLogger('queue');

/**
 * Build a fresh ioredis client tuned for BullMQ. The library requires:
 *   - maxRetriesPerRequest: null  (BullMQ handles its own retries)
 *   - enableReadyCheck: false     (BullMQ does its own readiness check)
 * Both are documented in BullMQ's connection guide.
 */
export function makeRedis(config: AppConfig): Redis {
  const client = new IORedis(config.queue.redis_url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  client.on('error', (err) => {
    log.error('redis error', { message: err.message });
  });
  return client;
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
    connection: makeRedis(config),
    defaultJobOptions: {
      attempts: config.queue.retry_attempts,
      backoff: { type: 'exponential', delay: 5_000 },
      // Keep job records for observability but don't let them grow forever.
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
    connection: makeRedis(config),
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
