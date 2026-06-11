/**
 * Thin API client. Wraps fetch with:
 *   - JSON Accept header
 *   - JSON body serialization when body is an object
 *   - Throws on non-2xx with a parsed error body when available
 *
 * No Authelia handling: the cookie is set by the proxy and rides along
 * automatically. If a request returns 401, that means the session
 * expired — we just let the redirect happen on next navigation.
 */
async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: options.signal,
    credentials: 'same-origin',
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    let detail: unknown = undefined;
    try {
      detail = await res.json();
    } catch {
      // body wasn't JSON; ignore
    }
    const err = new Error(`API ${method} ${path} failed: ${res.status}`) as Error & {
      status: number;
      detail: unknown;
    };
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function requestText(path: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(path, {
    method: 'GET',
    headers: { Accept: 'text/plain' },
    signal,
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.text();
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>('GET', path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
  rawText: (path: string, signal?: AbortSignal) => requestText(path, signal),
};

/**
 * Build a query string from an object of params. Skips undefined and
 * empty arrays. Arrays are joined with comma (matches the server-side
 * parsers in jobs/router.ts: `?status=new,reviewing`).
 */
export function qs(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v.join(','))}`);
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// ---------- Type definitions matching the API surface ----------

export type JobStatus =
  | 'new'
  | 'reviewing'
  | 'dismissed'
  | 'queued'
  | 'generating'
  | 'ready'
  | 'applied'
  | 'archived';

export interface Job {
  id: number;
  source_id: number;
  external_id: string;
  title: string;
  company: string;
  location: string | null;
  remote_type: 'remote' | 'hybrid' | 'onsite' | null;
  url: string;
  description: string;
  posted_date: string | null;
  discovered_at: string;
  hiring_manager: string | null;
  hiring_manager_source: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  fit_score: number | null;
  fit_reasons: string | null;
  status: JobStatus;
  dismissed_reason: string | null;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
}

export interface JobsListResponse {
  jobs: Job[];
  total: number;
  total_unfiltered: number;
  offset: number;
  limit: number;
}

export interface JobDetailResponse {
  job: Job;
  tags: Tag[];
}

// ---------- Profiles module ----------

export interface Profile {
  id: number;
  user_id: string;
  name: string;
  target_keywords: string | null;
  excluded_keywords: string | null;
  resume_version_id: number | null;
  is_default: number; // 0 | 1
  created_at: string;
  updated_at: string;
}

export interface ProfilesListResponse {
  profiles: Profile[];
}

// ---------- Resume module ----------

export type WritingSampleKind = 'cover_letter' | 'email' | 'bio' | 'other';

export interface MasterResume {
  id: number;
  version: number;
  content: string;  // structured JSON — see §6 of schema-v2.md
  notes: string | null;
  is_active: number;  // 0 | 1
  created_at: string;
}

export interface WritingSample {
  id: number;
  label: string;
  kind: WritingSampleKind;
  content: string;
  active: number;  // 0 | 1
  created_at: string;
}

export interface ResumeResponse {
  resume: MasterResume | null;
}

export interface ResumeVersionsResponse {
  versions: MasterResume[];
}

export interface WritingSamplesResponse {
  samples: WritingSample[];
}

// ---------- Applications module ----------

export type ApplicationStatus =
  | 'queued'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'applied'
  | 'archived';

export interface ApplicationWithJob {
  id: number;
  job_id: number;
  user_id: string;
  status: ApplicationStatus;
  queue_job_id: string | null;
  model_used: string | null;
  resume_version_id: number | null;
  resume_path: string | null;
  cover_letter_path: string | null;
  resume_diff: string | null;
  generation_notes: string | null;
  generation_error: string | null;
  generated_at: string | null;
  submitted_at: string | null;
  submission_notes: string | null;
  created_at: string;
  updated_at: string;
  // joined from jobs
  job_title: string;
  job_company: string;
  job_url: string;
  job_fit_score: number | null;
}

export interface ApplicationsListResponse {
  applications: ApplicationWithJob[];
}

export interface ApplicationResponse {
  application: ApplicationWithJob;
}
