# cranberrylabs-hr — Application Schema

A modular, standalone web application for personal job discovery, tailored document generation, and application tracking. Runs as its own service on `hr.cranberrylabs.net`, isolated from `cranberrylabs-api` and `cranberrylabs-web`. `cranberrylabs-web` links to it but does not share traffic, database, or code with it.

Designed with module-level extensibility so additional features (interview tracking, salary research, follow-up scheduling, hiring-manager enrichment) can be added later without touching the core.

---

## 1. High-Level Architecture

`cranberrylabs-hr` is a self-contained service. The frontend and API are bundled together (Express serving a built React SPA, or run as two containers in the same compose stack — see §15 deployment). Nothing else on the homelab reaches into its database or filesystem.

```
                              ┌──────────────────────┐
                              │  Authelia            │
                              │  login.cranberrylabs │
                              └──────────┬───────────┘
                                         │ forward_auth
                                         ▼
┌──────────────────────┐         ┌──────────────────────┐
│  cranberrylabs-web   │         │  Reverse Proxy       │
│  (existing)          │  link   │  (Caddy / Traefik)   │
│  ─────────────────   │ ──────▶ │  hr.cranberrylabs.net│
│  Dashboard tile or   │         └──────────┬───────────┘
│  link card to HR     │                    │
└──────────────────────┘                    ▼
                              ┌──────────────────────────────┐
                              │       cranberrylabs-hr       │
                              │  ┌────────────────────────┐  │
                              │  │  React SPA (frontend)  │  │
                              │  │  Jobs · Apps · Sources │  │
                              │  │  Resume · Settings     │  │
                              │  └────────────┬───────────┘  │
                              │               │ /api/*       │
                              │  ┌────────────▼───────────┐  │
                              │  │  Module Registry       │  │
                              │  │  ┌────┐┌────┐┌────┐    │  │
                              │  │  │jobs││apps││scrp│ …  │  │
                              │  │  └────┘└────┘└────┘    │  │
                              │  └────────────┬───────────┘  │
                              │  ┌────────────▼───────────┐  │
                              │  │  Shared Services       │  │
                              │  │  DB · Queue · LLM      │  │
                              │  └────────────────────────┘  │
                              └──────┬──────────┬─────────┬──┘
                                     ▼          ▼         ▼
                              ┌──────────┐ ┌────────┐ ┌──────────┐
                              │  SQLite  │ │ BullMQ │ │  Ollama  │
                              │ (HR-only)│ │  Redis │ │/Anthropic│
                              └──────────┘ └────────┘ └──────────┘

  NOTE: cranberrylabs-api is NOT in this diagram. It is a separate service
  on a separate hostname with a separate database. No shared traffic.
```

### Service Boundaries

| Concern | Owned by |
|---|---|
| Authentication | Authelia (shared infra) |
| Job dashboard, scraper, generation queue | `cranberrylabs-hr` |
| All HR-related data | `cranberrylabs-hr` (its own SQLite file) |
| Existing site / portfolio / other tools | `cranberrylabs-web` + `cranberrylabs-api` (unchanged) |
| Cross-service communication | **None.** `cranberrylabs-web` only renders an outbound link. |

This isolation is the point: traffic from morning scrapes, LLM generation calls, and queue polling never touches `cranberrylabs-api`. If HR goes down or you want to redeploy it, nothing else is affected.

---

## 2. Module System

The application is organized as feature modules, each self-contained with its own routes, services, and database migrations. A central registry mounts each module at startup.

### Module Contract

Every module exports the same shape:

```typescript
// src/modules/types.ts
export interface Module {
  name: string;                    // 'jobs', 'applications', etc.
  version: string;
  router: Router;                  // Express router mounted at /api/{name}
  migrations?: Migration[];        // DB migrations owned by this module
  workers?: WorkerDefinition[];    // BullMQ queues this module registers
  scheduledTasks?: CronTask[];     // Cron jobs (e.g., morning scrape)
  init?: (ctx: AppContext) => Promise<void>;
}
```

### Module Loader

```typescript
// src/modules/registry.ts
const modules: Module[] = [
  jobsModule,
  scraperModule,
  applicationsModule,
  resumeModule,
  notificationsModule,
  sourcesModule,
];

export async function loadModules(app: Express, ctx: AppContext) {
  for (const mod of modules) {
    await mod.init?.(ctx);
    await runMigrations(mod.migrations ?? []);
    mod.workers?.forEach(registerWorker);
    mod.scheduledTasks?.forEach(scheduleTask);
    app.use(`/api/${mod.name}`, mod.router);
  }
}
```

Adding a new feature later (LinkedIn scraper, interview tracker, salary research module) becomes a matter of dropping a new folder into `src/modules/` and adding one line to the registry.

### Initial Modules

| Module | Purpose |
|---|---|
| `sources` | CRUD for company career page URLs (Workday tenants) to scrape |
| `scraper` | Worker that visits sources, extracts postings, normalizes into `jobs` |
| `jobs` | Read/filter/tag/dismiss job postings, fit scoring |
| `applications` | Generation queue, tailored doc storage, status tracking |
| `resume` | Master resume + writing samples; templating for output |
| `retention` | TTL policies, pin/unpin, nightly sweep, audit log |
| `notifications` | Browser push / webhook / email on queue completion |

---

## 3. Database Schema

SQLite via `better-sqlite3`. Foreign keys enabled. Timestamps as ISO 8601 strings.

### `sources` — companies/URLs to scrape

```sql
CREATE TABLE sources (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name    TEXT    NOT NULL,
  platform        TEXT    NOT NULL,        -- 'workday' | 'greenhouse' | 'lever' | 'icims' | 'custom'
  tenant_url      TEXT    NOT NULL UNIQUE, -- e.g. https://acme.wd5.myworkdayjobs.com/External
  search_params   TEXT,                    -- JSON: { keywords: [...], locations: [...] }
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_scraped_at TEXT,
  last_status     TEXT,                    -- 'ok' | 'error' | 'blocked'
  last_error      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `jobs` — discovered postings

```sql
CREATE TABLE jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id       INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id     TEXT    NOT NULL,        -- platform's job ID, used for dedup
  title           TEXT    NOT NULL,
  company         TEXT    NOT NULL,
  location        TEXT,
  remote_type     TEXT,                    -- 'remote' | 'hybrid' | 'onsite' | NULL
  url             TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  description_hash TEXT   NOT NULL,        -- sha256, detects re-posts
  posted_date     TEXT,                    -- ISO date from posting
  discovered_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  hiring_manager  TEXT,                    -- discovered name if scraper can find it
  hiring_manager_source TEXT,              -- 'jd' | 'linkedin' | 'manual'
  salary_min      INTEGER,
  salary_max      INTEGER,
  salary_currency TEXT,
  fit_score       REAL,                    -- 0..1, computed at ingestion
  fit_reasons     TEXT,                    -- JSON array of matched keywords/criteria
  status          TEXT    NOT NULL DEFAULT 'new',
                                           -- 'new' | 'reviewing' | 'dismissed' | 'queued'
                                           -- | 'generating' | 'ready' | 'applied' | 'archived'
  dismissed_reason TEXT,
  UNIQUE(source_id, external_id)
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_posted ON jobs(posted_date);
CREATE INDEX idx_jobs_fit ON jobs(fit_score DESC);
```

### `job_tags` — flexible tagging

```sql
CREATE TABLE tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT    NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE job_tags (
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, tag_id)
);
```

### `master_resume` — single source of truth for your experience

```sql
CREATE TABLE master_resume (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version     INTEGER NOT NULL,            -- bumps on each edit, keeps history
  content     TEXT    NOT NULL,            -- structured JSON (see §6)
  notes       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `writing_samples` — voice calibration

```sql
CREATE TABLE writing_samples (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT    NOT NULL,             -- 'Cover letter - NetOps role 2024'
  kind       TEXT    NOT NULL,             -- 'cover_letter' | 'email' | 'bio' | 'other'
  content    TEXT    NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `applications` — generation + tracking

```sql
CREATE TABLE applications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id            INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  status            TEXT    NOT NULL DEFAULT 'queued',
                                          -- 'queued' | 'generating' | 'ready' | 'submitted' | 'failed'
  queue_job_id      TEXT,                 -- BullMQ job id, for status polling
  model_used        TEXT,                 -- 'claude-haiku-4-5' | 'ollama:llama3:70b' etc
  resume_version_id INTEGER REFERENCES master_resume(id),
  resume_path       TEXT,                 -- /storage/applications/{id}/resume.docx
  cover_letter_path TEXT,                 -- /storage/applications/{id}/cover.md
  resume_diff       TEXT,                 -- JSON of changes vs master
  generation_notes  TEXT,                 -- model's reasoning/suggestions
  generation_error  TEXT,
  generated_at      TEXT,
  submitted_at      TEXT,                 -- set when user marks applied
  submission_notes  TEXT,                 -- 'Submitted via Workday, confirmation #12345'
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_apps_status ON applications(status);
```

### `application_events` — audit log

```sql
CREATE TABLE application_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_type     TEXT    NOT NULL,        -- 'queued' | 'started' | 'completed' | 'submitted' | 'note'
  payload        TEXT,                    -- JSON
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### `scrape_runs` — observability for the scraper

```sql
CREATE TABLE scrape_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  status        TEXT    NOT NULL,         -- 'running' | 'ok' | 'error' | 'blocked'
  jobs_found    INTEGER DEFAULT 0,
  jobs_new      INTEGER DEFAULT 0,
  error_message TEXT
);
```

---

## 4. REST API Surface

Base path: `/api`. All endpoints return JSON. Authentication is handled upstream by Authelia (see §13); the API trusts forwarded identity headers.

### Sources

```
GET    /api/sources                  List all configured sources
POST   /api/sources                  Add a new Workday/Greenhouse/etc URL
GET    /api/sources/:id
PATCH  /api/sources/:id              Toggle enabled, edit keywords, etc.
DELETE /api/sources/:id
POST   /api/sources/:id/scrape       Trigger an ad-hoc scrape run
GET    /api/sources/:id/runs         Last N scrape_runs
```

### Jobs

```
GET    /api/jobs                     Query params:
                                       ?status=new,reviewing
                                       ?since=2026-05-11
                                       ?min_fit=0.6
                                       ?tag=remote
                                       ?source_id=3
                                       ?search=sysadmin
                                       ?limit=50&offset=0
GET    /api/jobs/:id                 Full detail + description
PATCH  /api/jobs/:id                 Update status, dismissed_reason, hiring_manager
POST   /api/jobs/:id/tags            { tag: 'priority' }
DELETE /api/jobs/:id/tags/:tagId
POST   /api/jobs/:id/dismiss         { reason: 'wrong-stack' }
POST   /api/jobs/:id/refit           Recompute fit_score against current master_resume
```

### Applications (Generation Queue)

```
POST   /api/applications             Enqueue generation
                                       Body: { job_ids: [1,2,3], model?: 'ollama' | 'anthropic' }
                                       Returns: { application_ids: [...], queue_status: {...} }
GET    /api/applications             List with filters by status
GET    /api/applications/:id         Full record + paths to generated docs
GET    /api/applications/:id/resume  Stream the resume file
GET    /api/applications/:id/cover   Stream the cover letter
POST   /api/applications/:id/regenerate
                                     Re-run generation, optionally with feedback
                                     Body: { feedback?: string, model?: string }
POST   /api/applications/:id/submit  Mark as submitted by you
                                       Body: { notes?: string }
DELETE /api/applications/:id         Removes from queue, keeps job in 'new'
GET    /api/applications/queue       Live queue status
                                     Returns: { active, waiting, completed, failed,
                                                eta_seconds, current_job }
```

### Resume & Writing

```
GET    /api/resume                   Active master_resume
GET    /api/resume/versions          History
POST   /api/resume                   Create new version (auto-bumps version#)
PATCH  /api/resume/:id/activate      Switch active version
GET    /api/resume/writing-samples
POST   /api/resume/writing-samples
PATCH  /api/resume/writing-samples/:id
DELETE /api/resume/writing-samples/:id
```

### Notifications

```
GET    /api/notifications/channels   List configured channels
POST   /api/notifications/channels   Add (browser-push subscription, webhook URL, email)
DELETE /api/notifications/channels/:id
POST   /api/notifications/test       Fire a test notification
```

### Server-Sent Events (live dashboard updates)

```
GET    /api/events                   SSE stream of:
                                       - scrape.started / scrape.completed
                                       - job.discovered
                                       - application.queued / started / ready / failed
                                       - queue.progress
```

SSE keeps the frontend reactive without polling. WebSockets are an alternative; SSE is simpler and one-way fits this use case.

---

## 5. Generation Pipeline

The core flow when an application is enqueued.

### Step 1 — Queue intake

```
POST /api/applications { job_ids: [42], model: 'anthropic' }
  ↓
Create `applications` row, status='queued'
  ↓
Enqueue BullMQ job: { application_id, job_id, model }
  ↓
Update job.status = 'queued'
  ↓
Emit SSE: application.queued
```

### Step 2 — Worker picks up job

```
Worker fetches application + job + active master_resume + active writing_samples
  ↓
Update applications.status = 'generating', job.status = 'generating'
Emit SSE: application.started
  ↓
Build LLM context (see §6)
  ↓
Call model adapter (Anthropic | Ollama)
  ↓
Parse structured response → { tailored_resume, cover_letter, change_notes }
```

### Step 3 — Render artifacts

```
Render resume from template + tailored content → /storage/applications/{id}/resume.docx
Write cover letter Markdown → /storage/applications/{id}/cover.md
  ↓
Update applications row: paths, model_used, generation_notes, generated_at
Set status = 'ready', job.status = 'ready'
  ↓
Emit SSE: application.ready
Fire notification if last in batch
```

### Step 4 — User reviews and submits manually

```
User downloads resume + cover from dashboard
User applies via Workday themselves
User clicks "Mark Applied" → POST /api/applications/:id/submit
  ↓
Status → 'submitted', submitted_at set, application_events row written
```

### Model Adapter Interface

```typescript
// src/services/llm/types.ts
export interface LLMAdapter {
  name: string;                          // 'anthropic' | 'ollama'
  generate(input: GenerationInput): Promise<GenerationOutput>;
}

export interface GenerationInput {
  jobDescription: string;
  jobMetadata: { title, company, location };
  masterResume: ResumeData;              // structured
  writingSamples: WritingSample[];
  preferences: { tone?: string; length?: 'short' | 'standard' };
}

export interface GenerationOutput {
  tailoredResume: ResumeData;            // same shape, reordered/edited
  coverLetterMarkdown: string;
  changeNotes: string[];                 // 'Moved AWS bullet to top', etc.
  rawModelOutput: string;
}
```

Adapters live under `src/services/llm/adapters/` — `anthropic.ts`, `ollama.ts`, future ones drop in.

---

## 6. Master Resume Format

JSON gives the model structured fields to reorder and prune, rather than a blob of prose to rewrite.

```json
{
  "contact": {
    "name": "...",
    "email": "...",
    "phone": "...",
    "location": "Toronto, ON",
    "links": [{"label": "GitHub", "url": "..."}]
  },
  "summary": "Optional 2-3 sentence headline",
  "experience": [
    {
      "id": "exp-1",
      "company": "...",
      "title": "...",
      "start": "2023-01",
      "end": "present",
      "location": "...",
      "bullets": [
        {
          "id": "b-1-1",
          "text": "Reduced incident MTTR by 40% by ...",
          "tags": ["sysadmin", "monitoring", "linux"],
          "metrics": ["40%"]
        }
      ]
    }
  ],
  "skills": [
    { "category": "Infrastructure", "items": ["Linux", "Proxmox", "..."] }
  ],
  "education": [...],
  "certifications": [...],
  "projects": [...]
}
```

The model receives this plus the JD and is instructed to:

1. Select most relevant bullets per role.
2. Optionally rewrite bullet text to surface keywords from the JD (returning both original and suggested).
3. Reorder sections by relevance.
4. Output a diff so the UI can show what changed.

---

## 7. Scraper Layer Detail

Each platform gets its own adapter under `src/modules/scraper/adapters/`. The module exposes a single dispatch function that routes by `source.platform`.

```typescript
// src/modules/scraper/adapters/workday.ts
export const workdayAdapter: ScraperAdapter = {
  platform: 'workday',
  async scrape(source: Source): Promise<ScrapedJob[]> {
    // Workday exposes a JSON API at:
    //   POST {tenant_url}/jobs
    // with body { appliedFacets, limit, offset, searchText }
    // This is far more reliable than HTML scraping.
    // ...
  }
};
```

### Workday-specific notes

- Workday's public job listing endpoint is a POST to `{tenant}/wday/cxs/{tenant}/{site}/jobs` returning JSON. Hitting it directly avoids the headless-browser fragility and Cloudflare friction entirely.
- The job detail endpoint (`/job/{jobId}`) returns the full description.
- Hiring manager is rarely in the JD but can sometimes be parsed from the description's "report to" lines or from the recruiter contact field if Workday surfaces it.

### Cron schedule

```typescript
// scraper module's scheduledTasks
[
  { name: 'morning-scrape', cron: '0 7 * * *', task: scrapeAllEnabled }
]
```

### Fit Scoring

Cheap, deterministic, runs at ingestion. Not the LLM — that's reserved for generation.

```typescript
function scoreFit(job: Job, masterResume: ResumeData, prefs: Preferences): {
  score: number;
  reasons: string[];
} {
  // Inputs:
  //   - target_keywords from prefs (sysadmin, IT, field tech, linux, etc.)
  //   - excluded_keywords (senior manager, sales, etc.)
  //   - skill matches between resume skills and JD
  //   - location / remote match
  //   - seniority match (years required vs experience)
  // Output: 0..1 with reasons array
}
```

This can be upgraded later to an embedding-based similarity score without changing the schema — `fit_score` is just a number.

---

## 8. Frontend Structure

React SPA bundled with the API as part of `cranberrylabs-hr`. Component conventions and styling can borrow from `cranberrylabs-web` for visual consistency, but the code lives in this repo independently — no shared component library dependency, to keep deployments decoupled.

### Linking from cranberrylabs-web

The existing site adds a single outbound link (dashboard tile, nav entry, or whatever fits the existing layout) pointing to `https://hr.cranberrylabs.net`. That's the entire integration surface. The link goes through Authelia, so unauthenticated clicks land on the login flow first.

### Routes

```
/jobs                        Today's filtered listings (default view)
/jobs/all                    All non-dismissed
/jobs/:id                    Job detail + actions
/applications                Queue + generated docs
/applications/:id            Review + download + mark applied
/sources                     Manage scrape sources
/resume                      Edit master resume + writing samples
/settings                    Model toggle, notification channels, cron
```

### Key Components

| Component | Purpose |
|---|---|
| `<JobList>` | Sortable table, multi-select, batch actions |
| `<JobRow>` | Title, company, fit score badge, posted date, action buttons |
| `<JobDetailDrawer>` | Slide-out with full JD, hiring manager, similar past jobs |
| `<QueueStatus>` | Live progress, ETA, current job, fail count — driven by SSE |
| `<ApplicationReview>` | Side-by-side: original vs tailored resume, change notes, edit-in-place |
| `<NotificationCenter>` | Browser push permission + channel config |
| `<SourceManager>` | Add/edit/disable Workday URLs, test scrape button |
| `<ResumeEditor>` | JSON-backed structured editor, version history |

### State Management

- Server state via React Query (`@tanstack/react-query`): fits cleanly with REST + SSE invalidation.
- Local UI state in component state / Zustand if it grows.
- SSE listener at app root dispatches cache invalidations.

---

## 9. Configuration

```yaml
# config/default.yaml
database:
  path: ./data/cranberrylabs-hr.sqlite

queue:
  redis_url: redis://localhost:6379
  concurrency: 2                # one or two parallel generations
  retry_attempts: 2

storage:
  root: ./storage/applications  # generated docs

llm:
  default_adapter: anthropic    # 'anthropic' | 'ollama'
  anthropic:
    model: claude-haiku-4-5
    max_tokens: 4000
  ollama:
    base_url: http://violet-admin.local:11434
    model: llama3:70b

scraper:
  user_agent: "JobDashBot/1.0 (personal use)"
  request_delay_ms: 2000
  cron: "0 7 * * *"
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
    min_posted_date_days_ago: 1

notifications:
  on_queue_complete: true
  channels: []                  # populated via UI
```

---

## 10. Build Order

Concrete, shippable steps:

1. **Bootstrap module loader + DB layer.** Empty modules registered, migrations runner, SSE endpoint emitting heartbeats. Nothing to scrape yet, but the skeleton compiles and runs.
2. **Sources + Scraper module — Workday adapter only.** Add a couple of company URLs via the API. Trigger ad-hoc scrapes. Jobs land in the DB. Verify dedup via `(source_id, external_id)`.
3. **Jobs module + Jobs list UI.** Filter to today's postings. Apply keyword filters server-side. Dismiss / mark applied works.
4. **Fit scoring v1 (keyword-based).** Backfill scores on existing jobs. Sort by fit on the list view.
5. **Master resume + writing samples.** UI to paste/edit JSON and samples. Active version flag.
6. **Applications module — single generation path with Anthropic adapter.** Click "Generate" on one job, get a cover letter + tailored resume saved to disk. Review UI shows the diff.
7. **BullMQ queue + worker concurrency.** Batch select multiple jobs, watch the queue drain. SSE-driven progress bar.
8. **Ollama adapter + model toggle.** UI switch on the application enqueue dialog.
9. **Notifications module.** Browser push + webhook channel. Fires on `queue.drained`.
10. **Retention module.** Sweep cron, pin/unpin endpoints, expiry badges in the UI. Default 7-day policy applied to all existing applications.
11. **Polish — tags, scrape_runs admin view, retry/regenerate-with-feedback button.**

After step 11 the system is feature-complete for the original scope. Future modules (interview tracker, salary research, post-application follow-up scheduler, hiring-manager enrichment) plug into the same registry.

---

## 11. Future Module Hooks

Designed-in extensibility points, listed for reference, not implemented up front:

- **Interview tracker** — new `interviews` table FK'd to `applications.id`, calendar integration.
- **Follow-up scheduler** — cron task in a new module reading `applications.submitted_at`, prompting a follow-up after N days.
- **Salary research** — module that hits Levels.fyi / Glassdoor APIs and joins onto `jobs.company`.
- **LinkedIn / Indeed adapters** — additional `ScraperAdapter` implementations for `source.platform = 'linkedin'` etc., no schema change required.
- **Embedding-based fit scoring** — swap the `scoreFit` implementation; the `fit_score` column already exists.
- **Multi-resume profiles** — `master_resume` already supports versions; add a `profile_id` column if you want separate resumes for different career tracks.

---

## 12. Resolved Design Decisions

1. **Standalone service** at `hr.cranberrylabs.net`. Isolated from `cranberrylabs-api` and `cranberrylabs-web` — separate code, separate database, separate container. `cranberrylabs-web` integrates only via an outbound link. See §1 and §15.
2. **Auth via Authelia** (`login.cranberrylabs.net`). The app implements no login flow of its own; Authelia handles authentication at the reverse proxy, and the API trusts forwarded identity headers. See §13.
3. **DOCX output** via the `docx` npm library. PDF export is a user-side step in Word if needed.
4. **7-day default retention with pinning**, implemented as its own `retention` module so the policy engine can grow over time. See §14.
5. **Hiring manager discovery deferred** to a future `enrichment` module. The `hiring_manager` and `hiring_manager_source` fields already exist in `jobs`; the scraper leaves them null for now.

---

## 13. Authelia Integration

Authelia sits in front of the reverse proxy and authenticates the user before any request reaches the API. The API's job is just to trust and read the headers Authelia forwards.

### Reverse Proxy Configuration

Whatever reverse proxy you use (Caddy, nginx, Traefik) needs to:

1. Send unauthenticated requests to Authelia's `/api/verify` endpoint first.
2. On success, forward the request to the API with these headers attached:
   - `Remote-User` — username
   - `Remote-Groups` — comma-separated group list
   - `Remote-Email` — email
   - `Remote-Name` — display name

Example Caddy snippet (illustrative):

```
hr.cranberrylabs.net {
  forward_auth login.cranberrylabs.net {
    uri /api/verify?rd=https://login.cranberrylabs.net
    copy_headers Remote-User Remote-Groups Remote-Email Remote-Name
  }
  reverse_proxy cranberrylabs-hr:3000
}
```

### API Middleware

A single middleware runs before any module route, extracting identity and rejecting requests that bypassed the proxy.

```typescript
// src/middleware/authelia.ts
export function autheliaIdentity(req, res, next) {
  const user = req.header('Remote-User');
  if (!user) {
    // Either the proxy is misconfigured or someone is hitting the API directly.
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = {
    username: user,
    email: req.header('Remote-Email'),
    name: req.header('Remote-Name'),
    groups: (req.header('Remote-Groups') ?? '').split(',').filter(Boolean),
  };
  next();
}
```

### Security Notes

- The API must only be reachable via the proxy. Bind it to `127.0.0.1` or a Docker-internal network so nothing else can hit it with spoofed headers. This is the single critical configuration to get right.
- For single-user setups (you), group checks are unnecessary. If the dashboard ever gets shared, group-based authorization is a one-line addition to the middleware.
- The internal service URL stays separate from the public hostname. Public: `hr.cranberrylabs.net`. Internal: `cranberrylabs-hr:3000` (or whatever the compose network resolves to).
- Because `cranberrylabs-hr` and `cranberrylabs-api` are separate services on separate subdomains, Authelia policies can be set per-domain — useful if you ever want different access rules for HR vs the main API.

---

## 14. Retention Module

Retention runs as a separate module so it stays composable as policies grow.

### Behavior

- **Default policy:** generated artifacts (resume + cover letter files) and the `applications` row are deleted 7 days after creation.
- **Pinning:** a user action on the application sets `pinned_at`. Pinned applications are exempt from retention sweeps regardless of age. UI treats this like starring an email.
- **Submitted ≠ pinned.** Marking applied does not automatically pin. If a job led somewhere worth keeping (interview, offer), you star it explicitly.
- **Sweep runs nightly** via a cron task registered by the module.
- **Sweep is logged** to a `retention_runs` table for observability — you can see what got cleaned up and why.

### Schema Additions

Add to `applications`:

```sql
ALTER TABLE applications ADD COLUMN pinned_at TEXT;
ALTER TABLE applications ADD COLUMN retention_policy TEXT NOT NULL DEFAULT 'default';
ALTER TABLE applications ADD COLUMN expires_at TEXT;     -- computed at creation/policy change
ALTER TABLE applications ADD COLUMN purged_at TEXT;      -- soft marker before hard delete
```

New tables:

```sql
CREATE TABLE retention_policies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL UNIQUE,    -- 'default' | 'keep-30d' | 'forever'
  description     TEXT,
  ttl_days        INTEGER,                    -- NULL = never expires
  applies_when    TEXT,                       -- JSON predicate, see below
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE retention_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  apps_scanned    INTEGER DEFAULT 0,
  apps_purged     INTEGER DEFAULT 0,
  apps_skipped_pinned INTEGER DEFAULT 0,
  status          TEXT,                       -- 'ok' | 'error'
  error_message   TEXT
);

CREATE TABLE retention_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id  INTEGER NOT NULL,           -- no FK; survives the app row's deletion
  job_title       TEXT,                       -- denormalized so the audit log is readable post-purge
  company         TEXT,
  action          TEXT    NOT NULL,           -- 'purged' | 'pinned' | 'unpinned' | 'policy_changed'
  reason          TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

Seed the default policy at migration time:

```sql
INSERT INTO retention_policies (name, description, ttl_days, is_default)
VALUES ('default', '7 days unless pinned', 7, 1);
INSERT INTO retention_policies (name, description, ttl_days)
VALUES ('keep-30d', 'Retain for 30 days', 30);
INSERT INTO retention_policies (name, description, ttl_days)
VALUES ('forever', 'Never auto-purge', NULL);
```

### Policy Engine

```typescript
// src/modules/retention/policy.ts
export interface RetentionPolicy {
  name: string;
  ttlDays: number | null;
  appliesWhen?: (app: Application, job: Job) => boolean;
}

export function computeExpiresAt(app: Application, job: Job): string | null {
  const policy = resolvePolicy(app, job);   // picks most-specific matching policy
  if (policy.ttlDays == null) return null;
  const base = new Date(app.created_at);
  base.setDate(base.getDate() + policy.ttlDays);
  return base.toISOString();
}
```

When a new application is created, `expires_at` is computed and stored. If you change an application's policy later (e.g. switch from default to `keep-30d`), the field is recomputed.

`appliesWhen` is the extension point — future policies can match on tags, fit score thresholds, company, submission status, etc. without changing the sweep logic.

### Sweep Worker

Registered by the module as a cron task:

```typescript
// src/modules/retention/sweep.ts
async function nightlySweep() {
  const run = await db.startRetentionRun();
  const candidates = await db.findApplications({
    expiresAtBefore: new Date().toISOString(),
    pinnedAt: null,
    purgedAt: null,
  });

  for (const app of candidates) {
    await deleteFiles(app.resume_path, app.cover_letter_path);
    await db.recordRetentionEvent(app, 'purged', 'ttl_expired');
    await db.deleteApplication(app.id);     // cascades to application_events
    run.purged++;
  }
  await db.finishRetentionRun(run);
}
```

Hard delete of `applications` is fine because `retention_events` preserves a readable audit trail (denormalized job title + company) even after the row is gone.

### API Surface

```
GET    /api/retention/policies              List policies
POST   /api/retention/policies              Define a new policy
PATCH  /api/retention/policies/:id

POST   /api/applications/:id/pin            Pin (immune to retention)
DELETE /api/applications/:id/pin            Unpin
PATCH  /api/applications/:id/policy         { policy: 'keep-30d' }

GET    /api/retention/runs                  Sweep history
GET    /api/retention/events                Per-application audit log
POST   /api/retention/sweep                 Manual trigger (for testing)
```

### UI Touchpoints

- **Star/pin icon** on every application row and detail view. Tooltip: "Pinned applications are never auto-deleted".
- **Days-to-expiry badge** on the application card: `Expires in 3 days` — turns amber at 2, red at 1.
- **Retention policy dropdown** on the application detail view: `default (7d)` / `keep-30d` / `forever` / future custom policies.
- **Settings page** lists policies and recent sweep runs.

### Why This Lives in Its Own Module

This module is small now but will grow. Likely future additions:

- Per-tag retention (`urgent` tag → 30 days automatically).
- Per-company retention (`Anthropic` → forever).
- Conditional rules (`fit_score > 0.8` → 30 days).
- Interview-aware retention (any application linked to a future `interviews` table auto-pins).
- Archive-instead-of-delete: move purged docs to cold storage rather than deleting them outright.

All of these are policy additions, not schema changes. Keeping the engine isolated means none of this leaks into the `applications` module's logic.

---

## 15. Deployment & Service Layout

### Repository

`cranberrylabs-hr` is a standalone repo with its own `package.json`, Dockerfile, and compose file. No code is shared with `cranberrylabs-api` or `cranberrylabs-web` at build time. If a utility ends up duplicated across services (e.g. a logger setup), that's an acceptable cost for keeping the deployments fully independent.

Suggested top-level layout:

```
cranberrylabs-hr/
├── api/                          # Express + module registry
│   ├── src/
│   │   ├── modules/
│   │   │   ├── sources/
│   │   │   ├── scraper/
│   │   │   ├── jobs/
│   │   │   ├── applications/
│   │   │   ├── resume/
│   │   │   ├── retention/
│   │   │   └── notifications/
│   │   ├── middleware/authelia.ts
│   │   ├── services/
│   │   │   ├── db/
│   │   │   ├── queue/
│   │   │   └── llm/
│   │   └── server.ts
│   ├── migrations/
│   └── package.json
├── web/                          # React SPA
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   └── lib/
│   └── package.json
├── docker-compose.yml
├── Dockerfile
└── config/
    ├── default.yaml
    └── production.yaml
```

The API can serve the built SPA directly (single container, simplest), or web + API can run as two containers in the same compose project (cleaner separation, hot-reload during dev). Either fits.

### Compose Stack

Illustrative — names align with how the rest of your homelab is likely organized:

```yaml
# docker-compose.yml
services:
  hr:
    build: .
    container_name: cranberrylabs-hr
    expose:
      - "3000"
    volumes:
      - ./data:/app/data                # SQLite file
      - ./storage:/app/storage          # generated resumes/cover letters
    environment:
      - NODE_ENV=production
      - CONFIG_PATH=/app/config/production.yaml
    depends_on:
      - hr-redis
    networks:
      - cranberrylabs

  hr-redis:
    image: redis:7-alpine
    container_name: cranberrylabs-hr-redis
    volumes:
      - ./redis-data:/data
    networks:
      - cranberrylabs

networks:
  cranberrylabs:
    external: true                      # shared with proxy + Authelia
```

Key points:

- **No published ports.** The service only listens on the internal Docker network. The reverse proxy (which also lives on that network) is the only way in.
- **Dedicated Redis** for the BullMQ queue. Separate from any Redis instance `cranberrylabs-api` might use — fully independent failure domain.
- **Volumes** for `data/` (SQLite) and `storage/` (generated docs). Both backed up via whatever backup strategy already covers the homelab.
- **Ollama is reached over the network** at `http://violet-admin.local:11434` per the config in §9 — it doesn't live in this compose file.

### Reverse Proxy

Add the `hr.cranberrylabs.net` block (Caddy example in §13) to whatever proxy config already handles the other subdomains. The `forward_auth` directive points at Authelia exactly the same way `cranberrylabs-web` and `cranberrylabs-api` already do — this service is just another protected subdomain from Authelia's perspective.

### DNS

One new A/AAAA (or CNAME) record: `hr.cranberrylabs.net` → same target as the other subdomains.

### Why Service Isolation Matters Here

- **Independent deployment.** Scraper bug at 7am doesn't risk the main site. `docker compose restart hr` doesn't touch anything else.
- **Independent dependencies.** This service may end up pulling in Playwright, document libraries, ML clients, and large LLM SDK packages. Keeping those out of `cranberrylabs-api` keeps its image small and its attack surface narrow.
- **Independent backup/retention.** The `data/` and `storage/` volumes can be backed up (or excluded) on their own schedule, separate from main-site data.
- **Independent secrets.** Anthropic API key, Ollama endpoint, and any future scraper credentials live in this service's environment only. Compromising the main API doesn't leak them.
