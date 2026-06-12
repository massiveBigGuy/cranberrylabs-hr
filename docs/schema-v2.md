# cranberrylabs-hr — Application Schema (v2)

A modular, standalone web application for personal job discovery,
tailored document generation, and application tracking. Runs as its
own service on `hr.cranberrylabs.net`, isolated from `cranberrylabs-api`
and `cranberrylabs-web`. `cranberrylabs-web` links to it but does not
share traffic, database, or code with it.

Designed with module-level extensibility so additional features
(interview tracking, salary research, follow-up scheduling,
hiring-manager enrichment) can be added later without touching the
core.

---

## Document status

**This is v2 of the schema.** The v1 document (`schema.md`) is the
original design; this version reflects what actually shipped through
build-order step 7.1 plus what's still planned. Use this document as
the current source of truth; consult v1 only when you need to see
the original intent for something that's been revised.

Sections marked **[shipped]** are live code. Sections marked
**[planned]** are designed but not yet built — they describe the
intended endpoint, schema, or behaviour for the step that will land
them. Sections marked **[revised from v1]** call out changes from
the original design and explain why.

Build-order progress:

- [x] Step 1 — Bootstrap
- [x] Step 2 — Sources + Scraper
- [x] Step 3 — Jobs module + list UI
- [x] Step 3.1 — Detail-sweep give-up, dual count, stats panel
- [x] Step 4 — Fit scoring v1
- [x] Step 5 — Master resume + writing samples
- [x] Step 6 — Single generation (Anthropic adapter)
- [x] Step 7 — Queue + concurrency
- [x] Step 7.1 — Multi-user + permissions
- [x] Step 7.2 — Profiles (per-role-type filter + resume + voice)
- [x] Step 7.3 — Manual job entry (synthetic source)
- [x] Step 8 — Ollama adapter + model toggle
- [x] Step 9 — Notifications
- [x] Step 10 — Retention
- [ ] Step 11 — Polish (scrape_runs admin view, regenerate-with-feedback, etc.)

---

## 1. High-Level Architecture [shipped]

`cranberrylabs-hr` is a self-contained service. The Express API
serves the built React SPA from the same container — single image,
single process. Nothing else on the homelab reaches into its database
or filesystem.

```
                              ┌──────────────────────┐
                              │  Authelia            │
                              │  login.cranberrylabs │
                              └──────────┬───────────┘
                                         │ forward_auth
                                         ▼
┌──────────────────────┐         ┌──────────────────────┐
│  cranberrylabs-web   │         │  Caddy               │
│  (existing)          │  link   │  (reverse proxy)     │
│  ─────────────────   │ ──────▶ │  hr.cranberrylabs.net│
│  Outbound link only  │         └──────────┬───────────┘
└──────────────────────┘                    │
                                            ▼
                              ┌──────────────────────────────┐
                              │       cranberrylabs-hr       │
                              │  ┌────────────────────────┐  │
                              │  │  React SPA (web/dist)  │  │
                              │  │  served by Express     │  │
                              │  └────────────┬───────────┘  │
                              │               │ /api/*       │
                              │  ┌────────────▼───────────┐  │
                              │  │  Module Registry       │  │
                              │  │  ┌────────┐┌────────┐  │  │
                              │  │  │sources ││scraper │  │  │
                              │  │  └────────┘└────────┘  │  │
                              │  │  ┌────────┐            │  │
                              │  │  │ jobs   │            │  │
                              │  │  └────────┘            │  │
                              │  └────────────┬───────────┘  │
                              │  ┌────────────▼───────────┐  │
                              │  │  Shared Services       │  │
                              │  │  DB · Queue · SSE      │  │
                              │  └────────────────────────┘  │
                              └──────┬──────────┬────────────┘
                                     ▼          ▼
                              ┌──────────┐ ┌────────┐
                              │  SQLite  │ │ Redis  │
                              │ (volume) │ │(BullMQ)│
                              └──────────┘ └────────┘

  NOTE: Modules registered through step 7.1 — sources, scraper, jobs,
  resume, applications, users. Future modules (profiles, notifications,
  retention) drop into the same registry per the build order. LLM
  adapters shipped in step 6 (Anthropic); Ollama planned for step 8.
```

### Service Boundaries

| Concern | Owned by |
|---|---|
| Authentication | Authelia (shared infra) |
| Job dashboard, scraper, generation queue | `cranberrylabs-hr` |
| All HR-related data | `cranberrylabs-hr` (its own SQLite file) |
| Existing site / portfolio / other tools | `cranberrylabs-web` + `cranberrylabs-api` (unchanged) |
| Cross-service communication | **None.** `cranberrylabs-web` only renders an outbound link. |

---

## 2. Module System [shipped]

The application is organized as feature modules, each self-contained
with its own routes, services, and database migrations. A central
registry mounts each module at startup.

### Module Contract

Every module exports the same shape:

```typescript
// api/src/modules/types.ts
export interface Module {
  name: string;
  version: string;
  router: Router;                  // mounted at /api/{name}
  migrations?: Migration[];
  workers?: WorkerDefinition[];
  scheduledTasks?: CronTask[];
  init?: (ctx: AppContext) => Promise<void>;
}
```

### Module Loader

```typescript
// api/src/modules/loader.ts
for (const mod of modules) {
  await mod.init?.(ctx);                              // init first
  await runMigrations(mod.migrations ?? []);
  mod.workers?.forEach(registerWorker);
  mod.scheduledTasks?.forEach(scheduleTask);
  app.use(`/api/${mod.name}`, mod.router);            // mount after init
}
```

`init` runs BEFORE the router is mounted. This is why modules can
build their real router inside `init` (with `AppContext` in scope)
and assign it to `module.router` — the loader picks up whatever's
on `module.router` at mount time. See `jobs/index.ts` for the
canonical example.

### Registered modules

| Module | Status | Purpose |
|---|---|---|
| `sources` | shipped (step 2) | CRUD for company career page URLs; scrape trigger |
| `scraper` | shipped (step 2) | Workday adapter; queue worker; hourly detail sweep |
| `jobs` | shipped (step 3 + 3.1) | Read/filter/tag/dismiss jobs; stats endpoint |
| `resume` | shipped (step 5) | Master resume + writing samples |
| `applications` | shipped (step 6) | Generation queue, tailored doc storage, status |
| `users` | shipped (step 7.1) | User registry, role assignments, permission checks |
| `profiles` | planned (step 7.2) | Per-role-type bundle: filter keywords + resume version + writing samples |
| `notifications` | planned (step 9) | Browser push / webhook / email |
| `retention` | planned (step 10) | TTL policies, pin/unpin, nightly sweep |

---

## 3. Database Schema

SQLite via `better-sqlite3`. Foreign keys enabled. Timestamps as ISO
8601 strings.

### `sources` — companies/URLs to scrape [shipped, extended in 7.1 + 7.2]

Created in `sources_001_init`. A `user_id TEXT NOT NULL` column was
added in `sources_002_user_id` (step 7.1); the `UNIQUE` constraint on
`tenant_url` was relaxed to `UNIQUE(user_id, tenant_url)` at the same
time, since two users may legitimately scrape the same company.

A `profile_id INTEGER` column is added in `sources_003_profile_id`
(step 7.2). Each source belongs to exactly one profile, which is how
a job inherits its profile — see §17. Existing sources are backfilled
to the per-user default profile during the step 7.2 migration. The
synthetic "Manual entry" source introduced in step 7.3 also carries a
`profile_id`, so every job reaches a profile through its source with
no special-casing.

```sql
CREATE TABLE sources (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name    TEXT    NOT NULL,
  platform        TEXT    NOT NULL,
  tenant_url      TEXT    NOT NULL,
  search_params   TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_scraped_at TEXT,
  last_status     TEXT,
  last_error      TEXT,
  user_id         TEXT    NOT NULL,                  -- added sources_002 (step 7.1)
  profile_id      INTEGER REFERENCES profiles(id),  -- added sources_003 (step 7.2)
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, tenant_url)
);
```

### `jobs` — discovered postings [shipped, extended in 3.1 + 7.1]

Created in `scraper_001_jobs`. Two columns added in
`scraper_003_detail_fetch_tracking` (step 3.1); `user_id` added in
`scraper_004_user_id` (step 7.1).

`jobs` gets **no** `profile_id` column. A job's profile is derived
through `source_id → sources.profile_id`. This keeps the derivation
universal and avoids a denormalized column that could drift out of
sync with its source.

```sql
CREATE TABLE jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id       INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id     TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  company         TEXT    NOT NULL,
  location        TEXT,
  remote_type     TEXT,
  url             TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  description_hash TEXT   NOT NULL,
  posted_date     TEXT,
  discovered_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  hiring_manager  TEXT,
  hiring_manager_source TEXT,
  salary_min      INTEGER,
  salary_max      INTEGER,
  salary_currency TEXT,
  fit_score       REAL,                    -- keyword fit 0.0–1.0, backfilled on boot
  fit_reasons     TEXT,                    -- JSON string[] e.g. ["title:sysadmin","desc:IT support"]
  status          TEXT    NOT NULL DEFAULT 'new',
  dismissed_reason TEXT,
  detail_fetch_attempts INTEGER NOT NULL DEFAULT 0,  -- added scraper_003 (step 3.1)
  detail_fetch_status   TEXT    NOT NULL DEFAULT 'pending',  -- added scraper_003
  user_id         TEXT    NOT NULL,        -- added scraper_004 (step 7.1)
  UNIQUE(source_id, external_id)
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_posted ON jobs(posted_date);
CREATE INDEX idx_jobs_fit ON jobs(fit_score DESC);
CREATE INDEX idx_jobs_detail_fetch ON jobs(detail_fetch_status);
```

Status values: `'new' | 'reviewing' | 'dismissed' | 'queued' |
'generating' | 'ready' | 'applied' | 'archived'`.

Detail-fetch status values: `'pending' | 'ok' | 'gave_up'`. A job
flips to `'gave_up'` after 5 consecutive failed detail fetches and
is excluded from future sweeps.

### `profiles` — per-role-type bundle [planned, step 7.2]

Created in `profiles_001_init`. A profile bundles the three things
that diverge when one user pursues more than one kind of role at once
(e.g. IT/infrastructure vs. a stopgap grocery/retail/food search): a
filter keyword set, a resume version, and a writing-sample voice. See
§17 for the full behaviour, ownership, and derivation rules.

```sql
CREATE TABLE profiles (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           TEXT    NOT NULL,              -- owner (Authelia Remote-User)
  name              TEXT    NOT NULL,              -- "IT / Infrastructure", "Stopgap"
  target_keywords   TEXT,                          -- JSON string[]; empty/null = match-all
  excluded_keywords TEXT,                          -- JSON string[]
  resume_version_id INTEGER REFERENCES master_resume(id),
  is_default        INTEGER NOT NULL DEFAULT 0,    -- the profile sources fall back to
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE INDEX idx_profiles_user ON profiles(user_id);
```

Exactly one profile per user carries `is_default = 1`. The step 7.2
migration creates it, seeds its keyword sets from the current
`scraper.filters` config (see §9), and attaches every existing source
to it. Writing samples join to a profile via `writing_samples.profile_id`
(see below); the resume a profile uses is the row pointed at by
`resume_version_id`.

### `tags` and `job_tags` [shipped]

Created in `jobs_001_tags` and `jobs_002_job_tags` (step 3).

**[revised from v1]** The v1 schema scheduled tag tables for step 11.
They landed in step 3 instead because the work was small and additive,
and dropping them in early let the jobs API surface ship complete in
one piece rather than with stub endpoints.

Tags remain **global** (no `user_id`, no `profile_id`) — a shared
vocabulary across all users and all profiles. See §12 decision 11.

```sql
CREATE TABLE tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT    NOT NULL UNIQUE,
  color TEXT
);
CREATE INDEX idx_tags_name ON tags(name);

CREATE TABLE job_tags (
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, tag_id)
);
CREATE INDEX idx_job_tags_tag ON job_tags(tag_id);
```

Tag names are case-folded on insert (`'Remote'` and `'remote'`
collapse to one row) for forgiving free-form input. If
case-preserving display names are wanted later, add a `display_name`
column — no breaking change required.

### `scrape_runs` — observability for the scraper [shipped]

Created in `scraper_002_scrape_runs`.

```sql
CREATE TABLE scrape_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  status        TEXT    NOT NULL,
  jobs_found    INTEGER DEFAULT 0,
  jobs_new      INTEGER DEFAULT 0,
  error_message TEXT
);
```

### `master_resume` — single source of truth for experience [shipped, step 5; extended 7.1]

A `user_id TEXT NOT NULL` column was added in `resume_002_user_id`
(step 7.1).

The `is_active` flag is **retained for now** but is largely
superseded by profiles: once a profile points at a specific version
via `profiles.resume_version_id`, "which version is active for this
profile" is answered structurally by that pointer, not by a flag.
Its fate (retire entirely vs. keep as a per-resume-family "active
version" marker) is deferred to the step 7.2 migration — see §17 and
§12 decision 15.

```sql
CREATE TABLE master_resume (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version     INTEGER NOT NULL,
  content     TEXT    NOT NULL,            -- structured JSON, see §6
  notes       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 0,
  user_id     TEXT    NOT NULL,            -- added resume_002 (step 7.1)
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `writing_samples` — voice calibration [shipped, step 5; extended 7.1 + 7.2]

A `user_id TEXT NOT NULL` column was added in `resume_003_user_id`
(step 7.1). A `profile_id INTEGER` column is added in
`resume_004_profile_id` (step 7.2): a writing sample belongs to one
profile's voice. During the 7.2 backfill, all existing samples are
attached to the user's default profile.

```sql
CREATE TABLE writing_samples (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT    NOT NULL,
  kind       TEXT    NOT NULL,             -- 'cover_letter' | 'email' | 'bio' | 'other'
  content    TEXT    NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  user_id    TEXT    NOT NULL,             -- added resume_003 (step 7.1)
  profile_id INTEGER REFERENCES profiles(id),  -- added resume_004 (step 7.2)
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `applications` — generation + tracking [shipped, step 6]

```sql
CREATE TABLE applications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id            INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  user_id           TEXT    NOT NULL,              -- Authelia Remote-User; scopes row to owner (step 7.1)
  status            TEXT    NOT NULL DEFAULT 'queued',
  queue_job_id      TEXT,
  model_used        TEXT,
  resume_version_id INTEGER REFERENCES master_resume(id),
  resume_path       TEXT,
  cover_letter_path TEXT,
  resume_diff       TEXT,
  generation_notes  TEXT,
  generation_error  TEXT,
  generated_at      TEXT,
  submitted_at      TEXT,
  submission_notes  TEXT,
  -- Retention columns (added in step 10):
  pinned_at         TEXT,
  retention_policy  TEXT    NOT NULL DEFAULT 'default',
  expires_at        TEXT,
  purged_at         TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_apps_status ON applications(status);
```

The `resume_version_id` on an application records which resume version
was actually used at generation time. With profiles (step 7.2), that
value is resolved from the job's profile rather than from a global
active flag — see §5 and §17.

### `application_events` — audit log [shipped, step 6]

```sql
CREATE TABLE application_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_type     TEXT    NOT NULL,
  payload        TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `application_versions` — generation history [planned, step 11]

Created in the next sequential applications migration
(`applications_*_versions`) at step 11. Each successful generation —
the initial one and every feedback-driven regeneration — writes a row
here. The `applications` row points at the current version via the
`is_current` flag (exactly one per application); its `resume_path` /
`cover_letter_path` columns mirror the current version so the existing
streaming endpoints keep working unchanged.

The `feedback` column holds the single feedback note that produced
*this* version (null for v1). The accumulated steering sent to the
model on a regeneration is assembled by walking these rows in
`version_no` order — so there's no separate feedback store to keep in
sync, and `application_events` keeps its existing audit role (logging
regeneration started/completed/failed, not the feedback text). See §19.

```sql
CREATE TABLE application_versions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id    INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  version_no        INTEGER NOT NULL,               -- 1, 2, 3 … linear, no branches
  resume_path       TEXT,
  cover_letter_path TEXT,
  resume_diff       TEXT,                            -- field-level diff vs master at this version
  feedback          TEXT,                            -- the feedback that produced THIS version; null for v1
  model_used        TEXT,
  generation_notes  TEXT,
  is_current        INTEGER NOT NULL DEFAULT 0,      -- the version the application points at
  prunable          INTEGER NOT NULL DEFAULT 0,      -- non-current; eligible for the retention sweep (step 10/§14)
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(application_id, version_no)
);

CREATE INDEX idx_app_versions_app ON application_versions(application_id);
```

### `users` — user registry [shipped, step 7.1]

```sql
CREATE TABLE users (
  username     TEXT    PRIMARY KEY,          -- Authelia Remote-User value
  email        TEXT,
  display_name TEXT,
  role         TEXT    NOT NULL DEFAULT 'user',  -- 'admin' | 'user' | 'viewer'
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT
);
```

### Retention tables [planned, step 10]

`retention_policies`, `retention_runs`, `retention_events` — see v1
schema §14 for full DDL. Unchanged from original design.

---

## 4. REST API Surface

Base path: `/api`. All endpoints return JSON. Authentication is
handled upstream by Authelia; the API trusts `Remote-User` and
rejects requests without it.

### Sources [shipped; extended 7.2]

```
GET    /api/sources                  list (scoped to user)
POST   /api/sources                  create  { ..., profile_id? }   ← profile_id added 7.2
GET    /api/sources/:id              detail
PATCH  /api/sources/:id              update (incl. profile_id)
DELETE /api/sources/:id
POST   /api/sources/:id/scrape       enqueue a scrape run
GET    /api/sources/:id/runs         scrape history
```

On create, `profile_id` defaults to the user's default profile when
omitted (step 7.2), so existing source-creation clients keep working
without change.

### Jobs [shipped]

```
GET    /api/jobs                     query params:
                                       ?status=new,reviewing  (or 'all')
                                       ?since=2026-05-11
                                       ?min_fit=0.6
                                       ?tag=remote
                                       ?source_id=3
                                       ?profile_id=2          (filter by profile, 7.2)
                                       ?search=sysadmin
                                       ?limit=50&offset=0
                                       ?filter=off            (disable keyword filter)
GET    /api/jobs/stats               aggregate counts for diagnostic panel
GET    /api/jobs/:id                 detail + tags (+ derived profile, 7.2)
PATCH  /api/jobs/:id                 update status, dismissed_reason, hiring_manager
POST   /api/jobs/:id/dismiss         { reason: '...' }
POST   /api/jobs/:id/tags            { tag: 'priority' }
DELETE /api/jobs/:id/tags/:tagId
POST   /api/jobs/:id/refit           → recomputes fit_score for one job (uses job's profile, 7.2)
```

**[revised from v1]** Two additions from step 3.1:

- `GET /api/jobs/stats` — returns scraped total, by-status
  distribution, keyword-filter pass/fail counts, and detail-fetch
  state. Backs the "Database breakdown" panel.
- `GET /api/jobs` response includes `total_unfiltered` alongside
  `total`. The UI uses this to render "X of Y jobs".

**[revised in 7.2]** `?profile_id=` filter added; `GET /api/jobs/:id`
detail now includes the derived profile (resolved through
`source_id`). The stats panel breakdown becomes per-profile aware.

Route ordering: `GET /stats` registers BEFORE `GET /:id` to prevent
the `:id` wildcard from matching the literal string `stats`.

### Profiles [planned, step 7.2]

```
GET    /api/profiles                 list current user's profiles (default first)
POST   /api/profiles                 create { name, target_keywords?, excluded_keywords?, resume_version_id? }
GET    /api/profiles/:id             detail + counts (sources, jobs, samples)
PATCH  /api/profiles/:id             update name / keywords / resume_version_id / is_default
DELETE /api/profiles/:id             delete; refuses if it is the default or still has sources attached
POST   /api/profiles/:id/refit       recompute fit_score for every job in this profile
```

Permission model follows §16: `user`-and-above manage their own
profiles; `viewer` is read-only. Setting `is_default = 1` on one
profile clears it on the user's others (single default invariant).
`DELETE` is guarded — the default profile cannot be deleted, and a
profile with attached sources must have them reassigned first (the
error body names the blocking sources).

### Applications (Generation Queue) [shipped steps 6 + 7]

```
POST   /api/applications             enqueue generation (BullMQ, 202)
GET    /api/applications             list; ?status=ready&job_id=42
GET    /api/applications/queue       live queue status (step 7)
GET    /api/applications/:id         detail + paths
GET    /api/applications/:id/cover   stream cover letter (text/plain)
GET    /api/applications/:id/resume  stream tailored resume (application/json) — current version
POST   /api/applications/:id/regenerate  regenerate (step 7); accepts { feedback? } at step 11
GET    /api/applications/:id/versions          list versions, newest first (step 11)
GET    /api/applications/:id/versions/:n/cover  stream a specific version's cover letter (step 11)
GET    /api/applications/:id/versions/:n/resume stream a specific version's resume (step 11)
POST   /api/applications/:id/versions/:n/activate  make version n current — rollback/selection (step 11)
POST   /api/applications/:id/submit  mark applied; { notes? }
DELETE /api/applications/:id         delete + clean up generated files; resets job → 'reviewing'
```

**[revised from v1]** Step 6 shipped synchronous generation; step 7 moved it
into a BullMQ worker. `POST /api/applications` returns 202 immediately;
the worker processes jobs with 3 attempts (2 retries) for transient LLM
failures. `queue_job_id` is populated on enqueue. File outputs are plain
text/JSON at `storage/applications/{id}/`. DOCX rendering is deferred to
step 11 polish.

**[7.1]** The `DELETE` handler resets the underlying job from `ready`
back to `reviewing` (fixed the stale-status parked issue).

**[7.2]** Generation resolves the resume version and writing samples
from the job's profile, not from global active flags — see §5.

**[planned, step 11]** `regenerate` accepts an optional `feedback`
string; each successful generation writes an `application_versions`
row, and `/versions/:n/activate` selects which version is current
(download/submit target). See §19.

### Resume & Writing [shipped, step 5]

```
GET    /api/resume                   active master_resume (or null)
GET    /api/resume/versions          full version history, newest first
POST   /api/resume                   create new version (content must be valid JSON)
PATCH  /api/resume/:id/activate      switch active version
GET    /api/resume/writing-samples   all writing samples (?profile_id= filter, 7.2)
POST   /api/resume/writing-samples   { label, kind, content, profile_id? }
PATCH  /api/resume/writing-samples/:id
DELETE /api/resume/writing-samples/:id
```

**[7.2]** Writing-sample endpoints gain an optional `profile_id`
(create) and `?profile_id=` filter (list). The relationship between
`PATCH /api/resume/:id/activate` and per-profile resume selection is
the open question recorded in §12 decision 15; until it's resolved at
migration time, `activate` continues to set the global `is_active`
flag and profiles point at versions independently via
`resume_version_id`.

### Users [shipped, step 7.1]

```
GET    /api/users                    admin only; list all users + roles
PATCH  /api/users/:username/role     admin only; { role: 'user' | 'viewer' }
GET    /api/users/me                 current user's profile + role
```

### Retention [planned, step 10]

Unchanged from v1.

### Server-Sent Events [shipped]

```
GET    /api/events                   SSE stream
```

Event names use dot notation: `scrape.started`, `scrape.completed`,
`job.discovered`, `application.queued`, `queue.progress`,
`heartbeat`. The frontend subscribes once at the app root and
invalidates React Query caches by event name. Future events follow
the same convention.

---

## 5. Generation Pipeline [shipped, steps 6 + 7; revised 7.2]

The model adapter interface, generation worker, BullMQ queue, batch
selection, and SSE progress streaming are all shipped.

### LLM Adapter interface [shipped, step 6]

Defined in `api/src/services/llm/types.ts`. A factory
`buildLLMAdapter(config)` in `api/src/services/llm/index.ts` creates the
correct adapter from `config.llm.default_adapter`. Currently only
`'anthropic'` is implemented; `'ollama'` is planned for step 8.

```typescript
interface LLMAdapter {
  readonly name: string;
  generate(req: GenerationRequest): Promise<GenerationResult>;
}
```

The `AnthropicAdapter` defers API-key validation to `generate()` time so
the container starts cleanly even when `ANTHROPIC_API_KEY` is not set.

### Generation flow [shipped step 6 / 7; revised 7.2]

`POST /api/applications { job_id }` enqueues a BullMQ job; the worker:

1. Validate job exists and has a description.
2. **[7.2] Resolve the job's profile** via `source_id →
   sources.profile_id`. Load that profile's resume version
   (`profiles.resume_version_id`) and the writing samples attached to
   that profile (`writing_samples.profile_id`). Pre-7.2 behaviour was:
   load the global active master resume and all active writing samples.
3. Call `adapter.generate(...)` — produces a cover letter and a tailored
   resume JSON from the Anthropic API.
4. Write `storage/applications/{id}/cover_letter.txt` and `.../resume.json`.
5. Compute a field-level diff (JSON array of `{ key, from, to }` entries).
6. Update the `applications` row to `status = 'ready'`; update the job
   to `status = 'ready'`. Record `resume_version_id = ` the profile's
   resolved version.
7. Emit SSE progress; the application row is the eventual result.

Model choice is **not** a profile attribute (see §17). The model used
comes from global config / the per-enqueue toggle (step 8), so the
Ollama work is orthogonal to profiles.

### Regenerate with feedback [planned, step 11]

`POST /api/applications/:id/regenerate { feedback }` reruns generation
with steering. The `GenerationRequest` gains two optional fields,
backward-compatibly (a first generation leaves them empty, so the
step 6/7 path is unchanged):

```typescript
interface GenerationRequest {
  // … existing fields (job, resume, writing samples) …
  previousOutput?: { coverLetter: string; resume: object };  // the current version's output
  feedback?: string[];                                        // accumulated notes, oldest → newest
}
```

The worker:

1. Load the current version's output as `previousOutput`.
2. Assemble `feedback` by reading `application_versions.feedback` in
   `version_no` order and appending the new note.
3. Call `adapter.generate(...)`; the adapter folds the previous draft
   and the accumulated feedback into the prompt.
4. On success, write a new `application_versions` row (`version_no` =
   max + 1), set it `is_current`, mark the prior current version
   `prunable`, and mirror its paths onto the `applications` row.
5. On failure, the previous version stays current and intact — a bad
   regeneration never costs the good draft. Status returns to `ready`.

This is steering, not a transcript replay: the model sees the latest
draft plus the cumulative feedback, not the full back-and-forth. See
§19 for the rationale and the versioning/rollback model.

---

## 6. Master Resume Format [shipped, step 5]

Unchanged from v1 schema §6. Content is stored as a JSON string in
`master_resume.content`. See v1 §6 for the full field reference.

---

## 7. Scraper Layer Detail [shipped, with revisions]

### Adapter pattern [shipped]

Each platform has its own adapter under
`api/src/modules/scraper/adapters/`. Currently only Workday is
implemented. The adapter interface in
`scraper/adapters/types.ts` defines `probe`, `scrape` (listing),
and `fetchDetail` (per-job description). "scraper" is a deliberately
loose umbrella: additional ATS adapters (and the manual-entry path in
step 7.3) register under the same module.

### Two-phase scrape [shipped, revised from v1]

**[revised from v1]** V1 described a single-pass scrape. The shipped
implementation is two-phase:

1. **Listing pass** — runs on demand or by cron, paginates Workday's
   JSON listing endpoint, normalizes results, upserts via
   `INSERT ... ON CONFLICT(source_id, external_id) DO NOTHING`.
   New rows have empty `description`.
2. **Detail sweep** — runs hourly via cron `5 * * * *`, picks up jobs
   with empty descriptions, fetches each one's full description.
   Capped at `PER_RUN_JOB_CAP = 300` per run with
   `request_delay_ms` pacing between requests.

The split exists because Workday's listing endpoint returns
abbreviated postings without full descriptions — fetching descriptions
inline during the listing pass would make a single scrape take 30+
minutes. Splitting them lets the listing pass complete quickly while
descriptions populate over the next hour or two.

### Detail-sweep give-up [shipped, step 3.1]

The detail sweep tracks per-job failure counts in
`jobs.detail_fetch_attempts`. After
`MAX_DETAIL_FETCH_ATTEMPTS = 5` consecutive failures, a job flips to
`detail_fetch_status = 'gave_up'` and is excluded from future sweeps.

Rationale: certain Workday postings return persistent 403s on the
detail endpoint despite the listing endpoint working. Without a
give-up threshold, the sweep retries forever and floods the logs.
Two known cases as of step 3.1 (GM job IDs 322 and 327).

### Workday URL parsing — known correctness point [shipped]

Workday's URL pattern is
`{tenant}.{pod}.myworkdayjobs.com/{site}` where `site` can be any
string including reserved-looking ones. CIBC's site is literally
`search`. The adapter treats the last path segment as the site name
verbatim — don't add special-casing for that.

### Cron schedule [shipped]

```typescript
// scraper module's scheduledTasks
[
  { name: 'scraper:detail-sweep', cron: '5 * * * *', task: runDetailSweep }
]
```

**[revised from v1]** V1 scheduled a `0 7 * * *` daily morning scrape.
The shipped behaviour is: listing-pass scrapes are triggered manually
via `POST /api/sources/:id/scrape` or by an external schedule (not
yet wired up in cron), and only the detail sweep runs on the
internal cron. A daily auto-scrape can be added later — the worker
and route already exist, just no cron entry yet.

### Fit Scoring [shipped, step 4; revised 7.2]

Keyword-based at ingestion, deterministic. Implemented in
`api/src/modules/jobs/fit-scorer.ts`:

- Any excluded keyword match in title or description → score 0.0
- Each signal keyword matching the title → +0.5 (capped at 1.0)
- Each signal keyword matching the description only → +0.15

Reasons stored as a JSON string array in `fit_reasons`, e.g.
`["title:sysadmin", "desc:IT support"]`. Scores are backfilled at
API startup for any jobs with a description but no score. New
descriptions fetched by the detail sweep are scored inline.
`POST /api/jobs/:id/refit` recomputes a single job's score on demand.
The list view sorts by fit descending by default (`?sort=fit`);
`?sort=date` restores the legacy date-only order.

**[revised 7.2]** The keyword sets are no longer read from
`scraper.filters` in `config`. The scorer loads `target_keywords` /
`excluded_keywords` from the **job's profile** (resolved via
`source_id → sources.profile_id`). This makes filters editable
DB rows per profile rather than a single global config-and-redeploy
gate. The step 7.2 migration seeds the default profile's keywords
from the existing config values, so scoring behaviour is unchanged
for already-scraped jobs until profiles are edited.
`POST /api/profiles/:id/refit` rescts every job in a profile after a
keyword change.

---

## 8. Frontend Structure [partially shipped]

React SPA bundled with the API. Vite + React 18 + React Query +
Tailwind + React Router.

### Routes

| Route | Status | Purpose |
|---|---|---|
| `/jobs` | shipped | Filtered listings (default view) |
| `/jobs/all` | planned | All non-dismissed (for now, use date filter "All" on `/jobs`) |
| `/jobs/:id` | not built | Deep-linkable detail; currently a drawer on `/jobs` |
| `/applications` | shipped (step 6/7) | Queue + generated docs |
| `/applications/:id` | shipped (step 6) | Review + download + mark applied |
| `/sources` | planned | Manage scrape sources (API-only for now) |
| `/profiles` | planned (step 7.2) | Manage profiles (API-only initially, like sources) |
| `/resume` | shipped (step 5) | Master resume + writing samples |
| `/settings` | planned | Model toggle, notifications, cron |

**[7.2]** A profile selector / filter is added to `/jobs` (filter the
list by profile). Full profile management UI is API-only initially,
matching how `sources` shipped; a `/profiles` page can follow in step
11 polish.

### State management

- React Query for server state. Query keys: `['jobs']`,
  `['jobs', jobId]`, `['jobs', 'stats']`, and (7.2) `['profiles']`.
  The SSE invalidator invalidates `['jobs']` on scrape events, which
  prefix-matches every jobs-related key.
- Component state for local UI; no Zustand yet.
- No browser storage — explicitly avoided per artifact storage rules.

---

## 9. Configuration [shipped, with revisions]

```yaml
# config/default.yaml — current shape
database:
  path: ./data/cranberrylabs-hr.sqlite

queue:
  redis_url: redis://hr-redis:6379
  concurrency: 2
  retry_attempts: 2

storage:
  root: ./storage/applications

llm:
  default_adapter: anthropic
  anthropic:
    model: claude-haiku-4-5
    max_tokens: 4000
  ollama:
    base_url: http://violet-admin.local:11434
    model: llama3:70b

scraper:
  user_agent: "JobDashBot/1.0 (personal use)"
  request_delay_ms: 2000
  filters:
    target_keywords:
      - sysadmin
      - "systems administrator"
      - "IT support"
      - "field technician"
      - "infrastructure engineer"
    excluded_keywords:
      - sales
      - "account executive"

notifications:
  on_queue_complete: true
  channels: []
```

**[revised from v1]** Removed the `scraper.cron` config key — the
detail-sweep cron is hardcoded as a `scheduledTasks` entry on the
scraper module (`'5 * * * *'`).

**[revised 7.2]** `scraper.filters` is no longer the live filter. As
of step 7.2 it serves a single purpose: it is the **seed** for the
per-user default profile's keyword sets at migration time. After 7.2,
filters live on `profiles` rows and are edited via the API, not the
config file. The key is kept (rather than removed) so the seed is
explicit and reproducible on a fresh deploy.

---

## 10. Build Order

Annotated with current status:

1. [x] **Step 1 — Bootstrap.** Module loader, DB layer, migration
   runner, SSE bus heartbeats. Skeleton compiles and runs.
2. [x] **Step 2 — Sources + Scraper.** Workday adapter, two-phase
   scrape, dedup via `(source_id, external_id)`, scrape-run history.
3. [x] **Step 3 — Jobs module + List UI.** Full `/api/jobs/*` surface,
   tags + job_tags tables, Vite/React workspace, `/jobs` page with
   filters and detail drawer.
4. [x] **Step 3.1 — Detail-sweep give-up, dual count, stats panel.**
   `scraper_003` migration, breakdown panel, `total_unfiltered`,
   `GET /api/jobs/stats`. Resolves a week-long retry loop and makes
   the filter gap legible.
5. [x] **Step 4 — Fit scoring v1 (keyword-based).** Backfill scores
   on existing jobs. Sort by fit on the list view. Wire up
   `POST /api/jobs/:id/refit`.
6. [x] **Step 5 — Master resume + writing samples.** UI to paste/edit
   JSON and samples. Active version flag.
7. [x] **Step 6 — Single generation path (Anthropic adapter).** Click
   "Generate" on one job, get a cover letter + tailored resume saved
   to disk. Review UI shows the diff.
8. [x] **Step 7 — BullMQ queue + worker concurrency.** Batch select
   multiple jobs, watch the queue drain. SSE-driven progress.
9. [x] **Step 7.1 — Multi-user + permissions.** Add `user_id` to all
   owned tables via migrations, scope all repo queries, wire up the
   `users` table and `requireRole` middleware, and add the `/api/users`
   surface. See §16.
10. [ ] **Step 7.2 — Profiles.** New `profiles` module + table; add
    `sources.profile_id` and `writing_samples.profile_id`; jobs derive
    their profile through `source_id`. Move fit-scorer keyword source
    and generation resume/sample selection from global config/flags to
    the job's profile. Backfill a per-user default profile from
    `scraper.filters`. See §17.
11. [ ] **Step 7.3 — Manual job entry.** A synthetic "Manual entry"
    source (per user, attachable to any profile) plus an endpoint to
    add a job by hand. Keeps `job → source → profile` universal so the
    stopgap profile can be populated where no ATS adapter exists. See
    §18.
12. [x] **Step 8 — Ollama adapter + model toggle.** UI switch on the
    enqueue dialog. Orthogonal to profiles (model is not a profile attr).
13. [x] **Step 9 — Notifications module.** Browser push + webhook
    channel. Fires on `queue.drained`.
14. [x] **Step 10 — Retention module.** Sweep cron, pin/unpin
    endpoints, expiry badges. Default 7-day policy.
15. [ ] **Step 11 — Polish.** Scrape_runs admin view, `/profiles` and
    `/sources` management UI, and **regenerate-with-feedback** — an
    iterative tuning loop on a completed application (feedback box on
    `/applications/:id`, versioned outputs, rollback). See §19. Plus
    anything left.

---

## 11. Future Module Hooks

Unchanged from v1.

---

## 12. Resolved Design Decisions

1. **Standalone service** at `hr.cranberrylabs.net`. [confirmed]
2. **Auth via Authelia.** [confirmed]
3. **DOCX output** via the `docx` npm library. [planned, step 11]
4. **7-day default retention with pinning.** [planned, step 10]
5. **Hiring manager discovery deferred.** [confirmed] The
   `hiring_manager` and `hiring_manager_source` fields exist in
   `jobs`; the scraper leaves them null unless found in the JD.
6. **[new] Two-phase scrape over single-pass.** Listing endpoint is
   fast; detail endpoint is slow and prone to per-URL failures.
   Splitting them lets the listing return immediately and lets
   description backfill be retryable.
7. **[new] Detail-sweep give-up after 5 attempts.** Per-URL
   permanent failures (Workday 403s on specific postings) shouldn't
   produce infinite retry noise. The threshold + `gave_up` status
   makes failures deterministic and visible in the stats panel.
8. **[new] Case-folded tag names.** Forgiving free-form input wins
   over case-preserving display. Reversible with a `display_name`
   column later if needed.
9. **[new] Tag tables landed in step 3, not step 11.** Originally
   scheduled for polish; landed early because they're additive and
   small.
10. **[new] Dual-count in list response.** `total_unfiltered`
    alongside `total` makes the keyword-filter gap legible at a
    glance — important because the gap is often 95%+ (845 scraped,
    25 shown in the step 3.1 deployment).
11. **[new] Global tags, per-user everything else.** Tags are a shared
    vocabulary across all users — no `user_id` on `tags` or `job_tags`.
    All other data (sources, jobs, resume, applications) is scoped to
    the owning Authelia username. See §16. Tags are also profile-blind:
    a tag is not scoped to a profile.
    Write access to tags is `user`-and-above; a `viewer` cannot create
    or delete tags. Tag application requires ownership of the job.
12. **[new] Auto-provisioned users, no registration flow.** First
    authenticated request upserts a `users` row from Authelia headers.
    Friends need an Authelia account; the HR app requires nothing
    additional from them.
13. **[new, 7.2] A profile bundles filter + resume + voice; sources
    belong to a profile; jobs derive theirs.** The three things that
    diverge when pursuing multiple role types at once are the filter
    keyword set, the resume version, and the writing-sample voice. A
    profile owns exactly those. A source points at one profile
    (`sources.profile_id`); a job's profile is derived through
    `source_id`, never stored on the job. This kills per-job
    assignment, keeps the derivation single-valued (one profile per
    job), and removes the "score a job against all profiles" problem.
    **Model choice is deliberately excluded** from the profile, so
    the Ollama/model-toggle work (step 8) stays orthogonal.
14. **[new, 7.2/7.3] Every job reaches a profile through a source —
    including manual entries.** Rather than allow source-less jobs,
    step 7.3 introduces a synthetic per-user "Manual entry" source
    that itself carries a `profile_id`. This keeps `job → source →
    profile` universal with no special-case branch, and means the
    stopgap profile (grocery/retail/food, where no ATS adapter exists)
    can be populated by hand. "scraper" remains a loose umbrella for
    future tailored ATS adapters.
15. **[open, decide at 7.2 migration] Fate of `master_resume.is_active`
    and the resume-versioning model.** Once a profile points at a
    version via `resume_version_id`, "active version for this profile"
    is structural and `is_active` is redundant for that purpose — lean
    toward retiring it. The one scenario where it could still earn its
    keep is a *per-resume-family* "active version" marker (multiple
    profiles sharing one resume lineage, with a flag picking the live
    version within that family). That only matters if resume isn't the
    profile differentiator, which is the degenerate case for this
    feature. The real substance to settle at migration time is whether
    `master_resume.version` stays a global integer counter or becomes
    per-resume-family numbering. Flag retained until then.
16. **[new, step 11] Regenerate-with-feedback: accumulated steering,
    linear versions, no branching, pruning deferred to retention.**
    The existing regenerate path gains an optional feedback string.
    The model is steered with the latest draft plus the cumulative
    feedback notes (assembled from the version history) rather than a
    replayed conversation transcript — cheaper, bounded, and adequate
    for resume/cover-letter tuning; full-conversation replay is a
    later evolution if needed. Each successful regeneration is a new
    linear version (`application_versions`); rolling back is
    *selecting* an existing version as current, not forking a branch —
    the feedback history is never truncated and a later regenerate
    still continues from the latest draft. Versions accumulate; their
    pruning is retention's job, deferred (see §14) rather than built
    into this feature.

---

## 13. Authelia Integration [shipped]

Unchanged from v1 schema §13 in design. Caddy's `forward_auth`
verifies sessions before requests reach the API; the API trusts
forwarded `Remote-User`, `Remote-Email`, `Remote-Name`, and
`Remote-Groups` headers.

**Known parked issue:** Authelia appears to re-prompt for credentials
more often than its session config suggests it should. Could be
session timeout config, cookie domain mismatch between subdomains,
or Caddy not forwarding the session cookie. Not investigated yet.

### Dev bypass [shipped]

`config/default.yaml` carries a `dev_bypass_user` value the middleware
uses when `NODE_ENV !== 'production'`. Lets the SPA dev server hit
the API without going through the proxy. The bypass user is seeded as
`admin` (step 7.1) and, on first run after step 7.2, owns the seeded
default profile.

---

## 14. Retention Module [planned, step 10]

Unchanged from v1 schema §14 for the application-level policy (TTL,
pin/unpin on the `applications` retention columns).

**Sequencing note re: generation versions (§19).** Retention (step 10)
ships *before* regenerate-with-feedback (step 11), so the
`application_versions` table doesn't exist when the retention sweep is
first built. Version-level pruning is therefore deferred: step 11
introduces versions with a `prunable` flag (non-current versions are
marked prunable) and keeps them all; extending the step-10 sweep to
also purge prunable, unpinned versions per policy lands with or just
after step 11. The rule of thumb: keep the current version and any
pinned version, prune the rest. No version pruning is built into step
10 itself.

---

## 15. Deployment & Service Layout [shipped, revised from v1]

### Repository structure (as built)

```
cranberrylabs-hr/
├── api/                          Express + module registry
│   ├── src/
│   │   ├── modules/
│   │   │   ├── sources/
│   │   │   ├── scraper/
│   │   │   │   ├── adapters/
│   │   │   │   ├── detail-sweep.ts
│   │   │   │   ├── repo-jobs.ts
│   │   │   │   └── ...
│   │   │   ├── jobs/
│   │   │   │   ├── repo.ts
│   │   │   │   ├── repo-tags.ts
│   │   │   │   ├── fit-scorer.ts
│   │   │   │   ├── router.ts
│   │   │   │   ├── migrations.ts
│   │   │   │   └── index.ts
│   │   │   ├── resume/
│   │   │   ├── applications/
│   │   │   ├── users/
│   │   │   ├── profiles/          (step 7.2)
│   │   │   ├── loader.ts
│   │   │   ├── registry.ts
│   │   │   └── types.ts
│   │   ├── middleware/authelia.ts
│   │   ├── services/
│   │   │   ├── db/
│   │   │   ├── llm/
│   │   │   ├── queue/
│   │   │   └── sse/
│   │   └── server.ts
│   ├── migrations/
│   └── package.json
├── web/                          React SPA (Vite)
│   ├── src/
│   │   ├── pages/JobsPage.tsx
│   │   ├── components/
│   │   ├── lib/
│   │   └── main.tsx
│   ├── index.html
│   └── package.json
├── deploy/
│   ├── UPGRADE-step1.md
│   ├── UPGRADE-step2.md
│   ├── UPGRADE-step3.md
│   ├── UPGRADE-step3.1.md
│   ├── UPGRADE-step4.md … UPGRADE-step7.1.md
├── config/
│   ├── default.yaml
│   └── production.yaml
├── docs/
│   ├── schema.md                 v1, original design
│   └── schema-v2.md              this document
├── docker-compose.yml
├── Dockerfile                    multi-stage: api-build, web-build, runtime
├── README.md
└── CLAUDE.md
```

### Dockerfile [shipped, revised from v1]

Multi-stage build with three stages:

1. **API build** (debian-slim) — TypeScript compilation. Debian is
   required because `better-sqlite3` is a native module needing
   `python3`, `make`, `g++`.
2. **Web build** (alpine) — Vite build of the SPA. Alpine is fine
   here because the toolchain is pure JS.
3. **Runtime** (debian-slim) — Copies API `dist` + pruned
   `node_modules` from stage 1, and `web/dist` from stage 2. Runs
   as UID 1000 under `tini` for signal handling. Healthcheck hits
   `/health`.

### Compose stack [shipped]

```yaml
services:
  hr:
    build: .
    container_name: cranberrylabs-hr
    ports:
      - "192.168.50.9:3000:3000"   # host LAN IP publish — see note
    volumes:
      - ./data:/app/data
      - ./storage:/app/storage
    depends_on:
      - hr-redis
  hr-redis:
    image: redis:7-alpine
    container_name: cranberrylabs-hr-redis
    volumes:
      - ./redis-data:/data
```

**[revised from v1]** The v1 schema described a shared Docker network
(`networks: cranberrylabs`) with `expose:` instead of `ports:`. The
shipped homelab pattern publishes to the host LAN IP
(`192.168.50.9:3000`) so Caddy reaches it via host networking rather
than a shared Docker network. This matches the convention used by
`cranberrylabs-api` and `cranberrylabs-web`.

A real lesson lost a half-day in step 2: `expose` only opens ports
internally to Docker; `ports` is required for host or external proxy
reachability. The two are not interchangeable.

### Reverse proxy [shipped]

Caddy block uses a `route` directive (not `reverse_proxy` alone) to
control header ordering — `request_header` directives must strip
client-supplied `Remote-*` headers BEFORE `forward_auth` adds the
verified ones. Misordering them produces a header-injection
vulnerability (cf. CVE-2026-30851 affecting Caddy 2.10.0–2.11.1).

---

## 16. Multi-User and Permissions [shipped, step 7.1]

The app is built for a single owner but designed to be shareable with
a small circle (friends). Authelia already provisions accounts — adding
a user is an Authelia config change, no code required. The HR app's
job is to scope data by identity and enforce a simple role model.

### Identity source

`Remote-User` (the Authelia username forwarded on every request) is
the stable identity key. It is already present on `req.user` from the
existing `autheliaIdentity` middleware. No app-level login flow is
needed.

### Data ownership model

Most tables are per-user. Tags are global (shared across all users —
see §12 decision 11). Profiles (step 7.2) are per-user.

Tables receiving `user_id TEXT NOT NULL` via migration at step 7.1:
- `sources` — each user manages their own scrape targets (`sources_002_user_id`)
- `jobs` — discovered from their sources; cascades naturally via FK (`scraper_004_user_id`)
- `master_resume`, `writing_samples` — personal (`resume_002_user_id`, `resume_003_user_id`)
- `applications` — already included in the step 6 DDL; no additional migration needed

Tables that remain global:
- `tags` — shared vocabulary; any user can create or apply tags
- `scrape_runs`, `application_events`, `retention_*` — follow their parent rows via FK

### Schema additions

A `users_001_init` migration creates the user registry (see §3 for DDL).

The `users` row is upserted on first authenticated request
(auto-provisioning from Authelia headers), so no manual registration
step is required when a new Authelia account is added. `last_seen_at`
is updated on each request. The owner is seeded as `admin` at
migration time; all subsequent auto-provisioned users default to
`user`.

### Role model

Three roles, enforced by a `requireRole(role)` middleware that reads
`req.user.username` against the `users` table:

| Role | What they can do |
|---|---|
| `admin` | Full access to all data; assign roles via API |
| `user` | Full access to their own data; can create and apply global tags; manage their own profiles |
| `viewer` | Read-only on their own data; cannot enqueue generation, write tags, or edit profiles |

### Query changes

Every repo query on a user-owned table carries a `WHERE user_id = ?`
clause bound to `req.user.username`. The BullMQ job payload carries
`user_id` so the worker loads the correct resume and writing samples
when it picks up a job. The scrape cron query (`SELECT * FROM sources
WHERE enabled = 1`) already scopes to each user's sources via
`user_id`.

### API additions

```
GET    /api/users                    admin only; list all users + roles
PATCH  /api/users/:username/role     admin only; { role: 'user' | 'viewer' }
GET    /api/users/me                 current user's profile + role
```

No user-deletion endpoint — removing an Authelia account prevents
future logins; a nightly sweep can tombstone inactive users if needed
later.

### What does NOT change

- Authelia configuration is out of scope; friends need an Authelia
  account added separately before the HR app will let them in.
- The dev bypass (`dev_bypass_user`) continues to work; the bypass
  user is seeded as `admin`.

---

## 17. Profiles [planned, step 7.2]

### Problem

A single user often runs more than one job search at once with
genuinely different shapes. The motivating case: an IT / infrastructure
search (the real target) alongside a stopgap search (grocery, retail,
food service) for income in the meantime. These differ in three
concrete ways — what counts as a relevant posting, which resume to
send, and what voice the cover letter should take. Tracking both under
one global filter, one active resume, and one active set of writing
samples is the source of the clutter this feature removes.

### What a profile is

A profile is a per-user bundle of exactly the things that diverge per
role type:

| Attribute | Why it's on the profile |
|---|---|
| `target_keywords` / `excluded_keywords` | The fit-scorer gate differs entirely between "infrastructure engineer" and "grocery clerk". |
| `resume_version_id` | The IT resume and the stopgap resume are different documents, not tones of one. |
| writing samples (via `writing_samples.profile_id`) | Cover-letter voice differs; the stopgap voice is shorter/plainer. |

Deliberately **not** on the profile: model choice (stays global / per-
enqueue, keeping step 8 orthogonal), tags (global shared vocabulary),
and notification/retention policy (global for now; can move later
without breaking the derivation).

### Derivation: jobs inherit, never store

The key simplification: **a source belongs to a profile, and a job's
profile is derived through its source.**

```
job.source_id ──▶ sources.profile_id ──▶ profiles.id
```

Consequences:
- No `profile_id` column on `jobs`, no per-job assignment step.
- A job belongs to exactly one profile — there is no "score against
  all profiles" fan-out.
- Re-pointing a source at a different profile re-classifies all its
  jobs at once (a `/api/profiles/:id/refit` or `/api/sources/:id`
  PATCH triggers a rescore).
- Step 7.3's synthetic "Manual entry" source carries a `profile_id`
  like any other source, so manually-entered jobs derive a profile
  identically — no source-less jobs, no branch.

### Schema (recap; full DDL in §3)

- `profiles_001_init` — creates `profiles` (per-user; `UNIQUE(user_id,
  name)`; single `is_default` per user).
- `sources_003_profile_id` — adds `sources.profile_id` (owned by the
  sources module).
- `resume_004_profile_id` — adds `writing_samples.profile_id` (owned
  by the resume module).

Migration ownership follows CLAUDE.md: a column's migration belongs to
the module that owns the table, even though the `profiles` module is
the feature driving the change.

### Migration & backfill

The step 7.2 migration must leave behaviour unchanged for existing
data, then let it be edited:

1. Create the `profiles` table.
2. For each existing `user_id` present in `sources`/`jobs`/`resume`,
   create one default profile (`is_default = 1`), seeding
   `target_keywords` / `excluded_keywords` from the current
   `scraper.filters` config values.
3. Point that profile's `resume_version_id` at the user's current
   active master resume (the row with `is_active = 1`), if any.
4. Backfill `sources.profile_id` to the user's default profile for
   every existing source.
5. Backfill `writing_samples.profile_id` to the user's default profile
   for every existing sample.
6. Leave `master_resume.is_active` untouched (see §12 decision 15).

After this runs, fit scores and generation produce identical output to
pre-7.2 until the user creates a second profile and points a source
at it.

### Behaviour changes

- **Fit scorer** (`jobs/fit-scorer.ts`): keyword source moves from
  `config.scraper.filters` to the job's profile. See §7.
- **Generation worker** (§5 step 2): resume version and writing samples
  are resolved from the job's profile rather than global active flags.
- **Jobs list/detail**: `?profile_id=` filter; detail includes the
  derived profile. Stats panel becomes profile-aware.

### Permissions

Per §16: `user`-and-above manage their own profiles; `viewer` is
read-only. The single-default invariant is enforced on write (setting
`is_default` clears it elsewhere for that user). `DELETE` refuses the
default profile and any profile with sources still attached.

### Out of scope for 7.2

- Profile management UI — API-only first, like `sources`. A `/profiles`
  page can land in step 11.
- Per-profile model/notification/retention policy — not needed yet;
  adding later doesn't disturb the derivation.

---

## 18. Manual Job Entry [planned, step 7.3]

### Why

The scraper is Workday-only, and adapters for hostile-ToS aggregators
(Indeed, LinkedIn) are a deliberate non-goal per CLAUDE.md. Many
stopgap employers (local grocery/retail/food) either don't use a
scrapable ATS or aren't worth writing an adapter for. To populate the
stopgap profile, the user needs to add a posting by hand. Manual entry
is also generally useful (a job heard about by word of mouth, a posting
on a one-off careers page).

### Design: a synthetic source

To keep `job → source → profile` universal (§17), manual jobs are not
source-less. Each user gets a synthetic source:

- `platform = 'manual'`, a reserved `tenant_url` sentinel
  (e.g. `manual://{username}`), `enabled = 0` so the scrape cron never
  touches it.
- It carries a `profile_id` like any source; the user can point it at
  whichever profile manual entries should default to (typically the
  stopgap profile), or set it per-entry.

The synthetic source is created lazily on first manual entry (or seeded
in the 7.2/7.3 migration).

### API

```
POST   /api/jobs/manual              create a job by hand
                                       { title, company, url?, location?,
                                         description, profile_id?, posted_date? }
```

- Writes a `jobs` row against the user's manual source. `external_id`
  is a generated UUID (no dedup against a remote system). `description`
  is required (so fit scoring and generation work immediately);
  `detail_fetch_status` is set to `'ok'` since there's nothing to sweep.
- `profile_id`, when given, re-points the manual source for that entry
  by resolving to the right profile; when omitted, inherits the manual
  source's current `profile_id`.
- Fit score is computed inline using the resolved profile's keywords.

### Out of scope for 7.3

- Editing a manual job's fields beyond the existing `PATCH /api/jobs/:id`
  surface.
- Bulk/CSV import — a later convenience if hand-entry gets tedious.

---

## 19. Regenerate with Feedback [planned, step 11]

### Problem

The current workflow is: generate a resume + cover letter from a
listing, review, download, upload by hand. If generation *fails*, the
BullMQ retry path covers it. But when it *succeeds* and the output
isn't good enough, the only recourse is to delete the application and
generate again from scratch — with no way to tell the model what to
change. The friction isn't the delete-and-remake mechanics; it's the
loss of the iterative, feedback-driven refinement available when
tuning a document by hand. This feature closes that gap inside the
review UI.

### Shape

It extends the existing async regenerate path rather than adding a new
surface. `POST /api/applications/:id/regenerate` gains an optional
`feedback` string. On `/applications/:id`, a prompt box sits below the
completed output; submitting it enqueues a regeneration (BullMQ, 202),
SSE streams progress, and a new version appears when it lands. Strictly
pre-submission — no auto-submit, consistent with the project's
human-in-the-loop rule.

### Context model — accumulated steering, not transcript replay

Generation stays effectively single-shot. Each regeneration sends the
original inputs (job, profile resume, profile writing samples), the
*current version's* output as `previousOutput`, and the accumulated
feedback notes assembled from the version history in order. The model
sees the latest draft and the cumulative steering ("more concise" →
"emphasize Kubernetes" → "warmer opening") without replaying a full
conversation.

Rationale: resume/cover-letter tuning is steering, not reasoning that
depends on earlier turns' exact phrasing. Accumulated notes capture the
intent at a fraction of the token cost and storage weight of a stored
conversation, and they keep the adapter contract simple. Full
conversation replay remains a clean later evolution if accumulated
steering proves insufficient.

### Versioning and rollback

Each successful generation — the first and every regeneration — is a
row in `application_versions` (see §3), numbered linearly. The
`applications` row points at the current version (`is_current`), and
its `resume_path` / `cover_letter_path` mirror it so existing download
endpoints keep working.

- **Non-destructive.** A failed regeneration leaves the current version
  intact; a worse result can be abandoned by re-activating an earlier
  version.
- **Rollback is selection, not branching.** `POST
  /api/applications/:id/versions/:n/activate` makes version *n* the
  download/submit target. The feedback history is never truncated, and
  a subsequent regenerate still continues from the latest draft.
  Branching (forking alternate drafts) is deliberately out of scope —
  tree-shaped history is complexity a personal tool doesn't need.
- **Each version is self-describing.** Its `feedback` column records the
  note that produced it, so the review UI can label versions plainly —
  "v2 — you asked: more concise" — without reconstructing intent.

### Adapter change (additive)

`GenerationRequest` gains optional `previousOutput` and `feedback`
fields (see §5). The initial generation leaves them empty, so the step
6/7 generation path is unchanged. The `AnthropicAdapter` folds them
into the prompt; the future Ollama adapter (step 8) inherits the same
contract.

### Storage and pruning

Versions accumulate under `storage/applications/{id}/v{n}/`. Pruning is
retention's responsibility, not this feature's: non-current versions
are marked `prunable`, and the step-10 retention sweep is extended to
purge prunable, unpinned versions per policy (keep current + pinned).
See §14 for the sequencing note (retention ships at step 10, versions
at step 11).

### Out of scope

- Branching / alternate-draft trees.
- Per-field targeted regeneration (e.g. "redo only the third bullet") —
  feedback is free-form and applies to the whole document; the model
  decides what to touch. The field-level diff against master still
  recomputes per version, so changes remain legible.
- Editing the generated output by hand in the UI — this is model-driven
  refinement; hand-editing is a separate idea if it's ever wanted.

---

## Document changelog

- **v2.3** (step 11 regenerate-with-feedback planning) — Added §19
  (Regenerate with Feedback) and the `application_versions` table (§3).
  Extended the `applications` API with feedback on `regenerate` plus
  version list / stream / activate endpoints. Added the additive
  `GenerationRequest` fields and the regeneration flow to §5. Added the
  retention sequencing note to §14 (version pruning deferred to extend
  the step-10 sweep) and decision 16. Expanded the step 11 build-order
  entry. The feature stays in step 11 (not pulled forward) — this is
  specification-ahead-of-build so the regeneration path is known to be
  clean before it's reached.
- **v2.2** (step 7.2 / 7.3 planning) — Added §17 (Profiles) and §18
  (Manual Job Entry). Added the `profiles` module and table; added
  `sources.profile_id` (`sources_003`) and `writing_samples.profile_id`
  (`resume_004`) migration notes. Moved fit-scorer keyword source and
  generation resume/sample selection from global config/flags to the
  job's derived profile. Documented the source→profile derivation and
  the synthetic manual source. Added build-order steps 7.2 and 7.3
  (sub-stepped to avoid renumbering 8–11). Added decisions 13–15
  (15 is the open `is_active`/versioning question). Marked steps 4–7.1
  shipped throughout (the v2 doc had left several sections describing
  them as planned). Reframed `scraper.filters` as the default-profile
  seed rather than the live filter.
- **v2.1** (step 7.1 planning) — Added §16 (Multi-User and Permissions).
  Added `user_id` to `applications` table DDL. Added migration notes
  to `sources`, `master_resume`, and `writing_samples` table entries.
  Inserted step 7.1 in build order; renumbered subsequent steps. Added
  `users` module to registered modules table. Added design decisions
  11–12. Removed redundant `user_roles` table (role is a column on
  `users`). Fixed default role to `user` (not `viewer`) for
  auto-provisioned accounts.
- **v2** (after step 3.1) — Marked shipped vs planned status across
  all sections. Documented `scraper_003` columns, `jobs_001/002` tag
  tables, two-phase scrape, give-up mechanism, dual count, stats
  endpoint, and the actual Dockerfile/compose shape. Captured the
  Authelia re-prompt parked issue. Removed `scraper.cron` config
  reference (now lives in `scheduledTasks`). Added decisions 6–10
  in §12.
- **v1** — Original design document, before any code was written.