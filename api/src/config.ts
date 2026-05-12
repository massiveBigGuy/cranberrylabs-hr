import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export interface AppConfig {
  server: { port: number; host: string };
  database: { path: string };
  queue: { redis_url: string; concurrency: number; retry_attempts: number };
  storage: { root: string };
  llm: {
    default_adapter: 'anthropic' | 'ollama';
    anthropic: { model: string; max_tokens: number };
    ollama: { base_url: string; model: string };
  };
  scraper: {
    user_agent: string;
    request_delay_ms: number;
    cron: string;
    filters: {
      target_keywords: string[];
      excluded_keywords: string[];
      min_posted_date_days_ago: number;
    };
  };
  notifications: { on_queue_complete: boolean; channels: unknown[] };
  auth: { dev_bypass_user: string | null };
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (typeof base !== 'object' || base === null) return (override as T) ?? base;
  if (typeof override !== 'object' || override === null) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override)) {
    const baseV = (base as Record<string, unknown>)[k];
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      baseV &&
      typeof baseV === 'object' &&
      !Array.isArray(baseV)
    ) {
      out[k] = deepMerge(baseV, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export function loadConfig(): AppConfig {
  // Default config is always loaded first.
  const defaultPath = path.resolve(__dirname, '../../config/default.yaml');
  const defaultDoc = yaml.load(fs.readFileSync(defaultPath, 'utf8')) as AppConfig;

  // Optional override. If CONFIG_PATH is set, the file MUST exist — silently
  // falling back to defaults masks the common "I typo'd the filename in
  // production" failure mode.
  const overridePath = process.env.CONFIG_PATH;
  if (overridePath) {
    if (!fs.existsSync(overridePath)) {
      throw new Error(
        `CONFIG_PATH was set to ${overridePath} but no file exists there. ` +
          `Either create the file or unset CONFIG_PATH to use defaults only.`,
      );
    }
    const overrideDoc = yaml.load(fs.readFileSync(overridePath, 'utf8')) as Partial<AppConfig>;
    return deepMerge(defaultDoc, overrideDoc);
  }
  return defaultDoc;
}
