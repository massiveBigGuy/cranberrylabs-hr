import type { AppConfig } from '../../../config';
import type { ScraperAdapter } from './types';
import { createWorkdayAdapter } from './workday';
import { createGreenhouseAdapter } from './greenhouse';
import { createLeverAdapter } from './lever';
import { createAshbyAdapter } from './ashby';

/**
 * Adapter registry. Add a new platform by writing an adapter file and
 * registering it here. The worker calls getAdapter(source.platform) to
 * dispatch.
 */
export function buildAdapters(config: AppConfig): Record<string, ScraperAdapter> {
  return {
    workday: createWorkdayAdapter(config),
    greenhouse: createGreenhouseAdapter(config),
    lever: createLeverAdapter(config),
    ashby: createAshbyAdapter(config),
  };
}

export function getAdapter(
  adapters: Record<string, ScraperAdapter>,
  platform: string,
): ScraperAdapter {
  const adapter = adapters[platform.toLowerCase()];
  if (!adapter) {
    throw new Error(`no adapter registered for platform '${platform}'`);
  }
  return adapter;
}

export type { ScraperAdapter } from './types';
