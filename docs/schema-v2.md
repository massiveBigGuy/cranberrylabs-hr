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
build-order step 3.1 plus what's still planned. Use this document as
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
- [ ] Step 6 — Single generation (Anthropic adapter)
- [ ] Step 7 — Queue + concurrency
- [ ] Step 8 — Ollama adapter + model toggle
- [ ] Step 9 — Notifications
- [ ] Step 10 — Retention
- [ ] Step 11 — Polish (scrape_runs admin view, etc.)

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

  NOTE: Three modules registered as of step 3.1 — sources, scraper,
  jobs. Future modules (resume, applications, retention, notifications)
  drop into the same registry per the build order. LLM adapters are
  planned for step 6; not yet present.
```

### Service Boundaries

| Concern | Owned by |
|---|---|
| Authentication | Authelia (shared infra) |
| Job dashboard, scraper, future generation queue | `cranberrylabs-hr` |
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
| `applications` | planned (step 6) | Generation queue, tailored doc storage, status |
| `notifications` | planned (step 9) | Browser push / webhook / email |
| `retention` | planned (step 10) | TTL policies, pin/unpin, nightly sweep |

---

## 3. Database Schema

SQLite via `better-sqlite3`. Foreign keys enabled. Timestamps as ISO
8601 strings.

### `sources` — companies/URLs to scrape [shipped]

Created in `sources_001_init`.

```sql
CREATE TABLE sources (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name    TEXT    NOT NULL,
  platform        TEXT    NOT NULL,
  tenant_url      TEXT    NOT NULL UNIQUE,
  search_params   TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_scraped_at TEXT,
  last_status     TEXT,
  last_error      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `jobs` — discovered postings [shipped, extended in 3.1]

Created in `scraper_001_jobs`. Two columns added in
`scraper_003_detail_fetch_tracking` (step 3.1).

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
  -- Added in scraper_003 (step 3.1):
  detail_fetch_attempts INTEGER NOT NULL DEFAULT 0,
  detail_fetch_status   TEXT    NOT NULL DEFAULT 'pending',
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

### `tags` and `job_tags` [shipped]

Created in `jobs_001_tags` and `jobs_002_job_tags` (step 3).

**[revised from v1]** The v1 schema scheduled tag tables for step 11.
They landed in step 3 instead because the work was small and additive,
and dropping them in early let the jobs API surface ship complete in
one piece rather than with stub endpoints.

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

### `master_resume` — single source of truth for experience [shipped, step 5]

```sql
CREATE TABLE master_resume (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version     INTEGER NOT NULL,
  content     TEXT    NOT NULL,            -- structured JSON, see §6
  notes       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `writing_samples` — voice calibration [shipped, step 5]

```sql
CREATE TABLE writing_samples (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT    NOT NULL,
  kind       TEXT    NOT NULL,             -- 'cover_letter' | 'email' | 'bio' | 'other'
  content    TEXT    NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `applications` — generation + tracking [planned, step 6]

```sql
CREATE TABLE applications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id            INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
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

### `application_events` — audit log [planned, step 6]

```sql
CREATE TABLE application_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_type     TEXT    NOT NULL,
  payload        TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
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

### Sources [shipped]

```
GET    /api/sources                  list
POST   /api/sources                  create
GET    /api/sources/:id              detail
PATCH  /api/sources/:id              update
DELETE /api/sources/:id
POST   /api/sources/:id/scrape       enqueue a scrape run
GET    /api/sources/:id/runs         scrape history
```

### Jobs [shipped]

```
GET    /api/jobs                     query params:
                                       ?status=new,reviewing  (or 'all')
                                       ?since=2026-05-11
                                       ?min_fit=0.6
                                       ?tag=remote
                                       ?source_id=3
                                       ?search=sysadmin
                                       ?limit=50&offset=0
                                       ?filter=off            (disable keyword filter)
GET    /api/jobs/stats               aggregate counts for diagnostic panel
GET    /api/jobs/:id                 detail + tags
PATCH  /api/jobs/:id                 update status, dismissed_reason, hiring_manager
POST   /api/jobs/:id/dismiss         { reason: '...' }
POST   /api/jobs/:id/tags            { tag: 'priority' }
DELETE /api/jobs/:id/tags/:tagId
POST   /api/jobs/:id/refit           → recomputes fit_score for one job
```

**[revised from v1]** Two additions to the v1 design:

- `GET /api/jobs/stats` (step 3.1) — returns scraped total, by-status
  distribution, keyword-filter pass/fail counts, and detail-fetch
  state. Backs the "Database breakdown" panel.
- `GET /api/jobs` response now includes `total_unfiltered` alongside
  `total`. The UI uses this to render "X of Y jobs" so the gap between
  filtered and scraped is legible.

Route ordering: `GET /stats` registers BEFORE `GET /:id` to prevent
the `:id` wildcard from matching the literal string `stats`.

### Applications (Generation Queue) [planned, steps 6–7]

Unchanged from v1 design.

```
POST   /api/applications             enqueue generation
GET    /api/applications             list with filters
GET    /api/applications/:id         detail + paths
GET    /api/applications/:id/resume  stream the resume file
GET    /api/applications/:id/cover   stream the cover letter
POST   /api/applications/:id/regenerate
POST   /api/applications/:id/submit
DELETE /api/applications/:id
GET    /api/applications/queue       live queue status
```

### Resume & Writing [shipped, step 5]

```
GET    /api/resume                   active master_resume (or null)
GET    /api/resume/versions          full version history, newest first
POST   /api/resume                   create new version (content must be valid JSON)
PATCH  /api/resume/:id/activate      switch active version
GET    /api/resume/writing-samples   all writing samples
POST   /api/resume/writing-samples   { label, kind, content }
PATCH  /api/resume/writing-samples/:id
DELETE /api/resume/writing-samples/:id
```

### Retention [planned, step 10]

Unchanged from v1.

### Server-Sent Events [shipped]

```
GET    /api/events                   SSE stream
```

Event names use dot notation: `scrape.started`, `scrape.completed`,
`job.discovered`, `heartbeat`. The frontend subscribes once at the
app root and invalidates React Query caches by event name. Future
events (`application.queued`, `queue.progress`, etc.) follow the same
convention.

---

## 5. Generation Pipeline [planned, steps 6–7]

Unchanged from v1 schema §5. The model adapter interface, queue
flow, and review workflow are all designed but unbuilt.

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
and `fetchDetail` (per-job description).

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

### Fit Scoring [shipped, step 4]

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

---

## 8. Frontend Structure [partially shipped]

React SPA bundled with the API. Vite + React 18 + React Query +
Tailwind + React Router.

### Routes

| Route | Status | Purpose |
|---|---|---|
| `/jobs` | shipped | Today's filtered listings (default view) |
| `/jobs/all` | planned | All non-dismissed (for now, use date filter "All" on `/jobs`) |
| `/jobs/:id` | not built | Deep-linkable detail; currently a drawer on `/jobs` |
| `/applications` | planned (step 6) | Queue + generated docs |
| `/applications/:id` | planned (step 6) | Review + download + mark applied |
| `/sources` | planned | Manage scrape sources (API-only for now) |
| `/resume` | planned (step 5) | Master resume + writing samples |
| `/settings` | planned | Model toggle, notifications, cron |

### Shipped components

| Component | Purpose |
|---|---|
| `<App>` | Layout + top nav + SSE subscription at root |
| `<JobsPage>` | The `/jobs` route |
| `<JobList>` | Sortable table |
| `<JobRow>` | Single row with relative-time formatting |
| `<JobDetailDrawer>` | Slide-out detail panel with status/dismiss/tag actions |
| `<JobStatsPanel>` | Collapsible "Database breakdown" diagnostic (step 3.1) |

### State management

- React Query for server state. Query keys: `['jobs']`,
  `['jobs', jobId]`, `['jobs', 'stats']`. The SSE invalidator
  invalidates `['jobs']` on scrape events, which prefix-matches every
  jobs-related key.
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

# LLM config — not yet read by any code, lands in step 6
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
scraper module (`'5 * * * *'`). If per-source scrape schedules are
wanted later, that's a sources-table column, not a global config.

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
7. [ ] **Step 6 — Single generation path (Anthropic adapter).** Click
   "Generate" on one job, get a cover letter + tailored resume saved
   to disk. Review UI shows the diff.
8. [ ] **Step 7 — BullMQ queue + worker concurrency.** Batch select
   multiple jobs, watch the queue drain. SSE-driven progress.
9. [ ] **Step 8 — Ollama adapter + model toggle.** UI switch on the
   enqueue dialog.
10. [ ] **Step 9 — Notifications module.** Browser push + webhook
    channel. Fires on `queue.drained`.
11. [ ] **Step 10 — Retention module.** Sweep cron, pin/unpin
    endpoints, expiry badges. Default 7-day policy.
12. [ ] **Step 11 — Polish.** Scrape_runs admin view, retry/regenerate-
    with-feedback button, anything left.

---

## 11. Future Module Hooks

Unchanged from v1.

---

## 12. Resolved Design Decisions

1. **Standalone service** at `hr.cranberrylabs.net`. [confirmed]
2. **Auth via Authelia.** [confirmed]
3. **DOCX output** via the `docx` npm library. [planned, step 6]
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
    25 shown in the current deployment).

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
the API without going through the proxy.

---

## 14. Retention Module [planned, step 10]

Unchanged from v1 schema §14.

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
│   │   │   │   ├── router.ts
│   │   │   │   ├── migrations.ts
│   │   │   │   └── index.ts
│   │   │   ├── loader.ts
│   │   │   ├── registry.ts
│   │   │   └── types.ts
│   │   ├── middleware/authelia.ts
│   │   ├── services/
│   │   │   ├── db/
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
│   └── UPGRADE-step3.1.md
├── config/
│   ├── default.yaml
│   └── production.yaml
├── docs/
│   ├── schema.md                 v1, original design
│   └── schema-v2.md              this document
├── docker-compose.yml
├── Dockerfile                    multi-stage: api-build, web-build, runtime
├── README.md
├── CLAUDE.md
└── job-dashboard-schema.md       (legacy location of v1, see docs/)
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

## Document changelog

- **v2** (after step 3.1) — Marked shipped vs planned status across
  all sections. Documented `scraper_003` columns, `jobs_001/002` tag
  tables, two-phase scrape, give-up mechanism, dual count, stats
  endpoint, and the actual Dockerfile/compose shape. Captured the
  Authelia re-prompt parked issue. Removed `scraper.cron` config
  reference (now lives in `scheduledTasks`). Added decisions 6–10
  in §12.
- **v1** — Original design document, before any code was written.
