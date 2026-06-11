# cranberrylabs-hr

Personal job-search automation. Scrapes career pages, filters, tags,
and fit-scores discovered postings, and drives LLM-assisted resume and
cover-letter generation. Human-in-the-loop by design — no
auto-submission.

Runs as an isolated service on the homelab at `hr.cranberrylabs.net`,
behind Caddy + Authelia. Separate code, separate database, and
separate Redis from `cranberrylabs-api` and `cranberrylabs-web`. The
existing site links to it but shares nothing with it.

## Current state — end of step 7.1

The pipeline runs end to end: discover → fit-score → generate → review
→ submit (by hand). Generation runs through a BullMQ worker pool, and
all data is scoped per user behind Authelia. From a fresh clone:

```bash
docker compose up -d --build
```

…brings up the API, the SPA, Redis (BullMQ queues), and the
cron-driven detail sweep. After authenticating through Authelia,
`hr.cranberrylabs.net/jobs` shows discovered postings with filters and
a detail drawer; `/applications` holds generated documents for review
and download; `/resume` manages the master resume and writing samples.

### What works

- **Sources management** — Workday tenant URLs registered via
  `POST /api/sources`; each can be enabled, disabled, manually
  triggered, and inspected via `GET /api/sources/:id/runs`.
- **Two-phase scraping** — a queued listing pass discovers postings
  via Workday's JSON API; an hourly cron sweep fetches each posting's
  full description.
- **Detail-sweep give-up** — jobs the sweep can't fetch after 5
  consecutive failures are flipped to `detail_fetch_status = 'gave_up'`
  and excluded from future runs. Stops the retry-loop noise hit with
  two GM postings.
- **Jobs API** — `GET /api/jobs` with status, date, source, tag, fit,
  and search filters; per-job tag attach/detach; dismiss with reason;
  hiring-manager edit.
- **Stats endpoint** — `GET /api/jobs/stats` returns aggregate counts
  (scraped total, by-status distribution, keyword-filter pass/fail,
  detail-fetch state) backing the diagnostic panel.
- **Fit scoring (step 4)** — deterministic keyword-based score computed
  at ingestion and backfilled on boot. `POST /api/jobs/:id/refit`
  recomputes one job; the list view sorts by fit descending by default
  (`?sort=fit`, with `?sort=date` for the legacy order).
- **Master resume + writing samples (step 5)** — structured JSON resume
  with version history and an active-version flag; writing samples for
  cover-letter voice calibration. Full `/api/resume/*` surface and a
  `/resume` page.
- **Single generation path (step 6)** — Anthropic adapter; "Generate"
  on a job produces a tailored resume + cover letter saved to disk,
  with a field-level diff against the master resume shown in the review
  UI.
- **Queue + concurrency (step 7)** — batch-select multiple jobs;
  generation runs in a BullMQ worker pool (3 attempts for transient LLM
  failures) with SSE-driven queue-status progress. `POST
  /api/applications` returns 202 and the worker fills in the result.
- **Multi-user + permissions (step 7.1)** — every owned table
  (`sources`, `jobs`, `master_resume`, `writing_samples`,
  `applications`) is scoped by the Authelia `Remote-User`. A `users`
  registry with `admin` / `user` / `viewer` roles is enforced by
  `requireRole`; users are auto-provisioned on first authenticated
  request. `GET /api/users`, `PATCH /api/users/:username/role`, and
  `GET /api/users/me` manage roles. Tags stay global (a shared
  vocabulary); everything else is per-owner.
- **Frontend** — Vite + React + React Query + Tailwind. `/jobs` (date
  filter, title/company search, dual "X of Y jobs" count, collapsible
  "Database breakdown" panel, detail drawer with status/dismiss/tag
  actions), `/applications` (queue + review + download + mark-applied),
  and `/resume`.
- **Live updates** — SSE on `/api/events` pushes scrape and queue
  events; the frontend invalidates React Query caches on receipt, so
  new jobs and generation results land without a refresh.
- **Authelia integration** — `autheliaIdentity` middleware sits in
  front of every API route; requests without `Remote-User` are
  rejected. Caddy's `forward_auth` enforces this at the reverse proxy.

### Historical snapshot — as of step 3.1

These figures motivated fit scoring (step 4) and are kept for the
reasoning trail. They are a step-3.1 deployment snapshot, not current
numbers — rerun a live `sqlite3` query for today's counts:

- 845 jobs in the database
- 843 with descriptions, 2 marked `gave_up` (GM postings 322 and 327 —
  Workday returns 403 on those specific URLs)
- 25 visible in the default Jobs view; 820 filtered by the configured
  `target_keywords` / `excluded_keywords`

The 25/845 gap was the signal that keyword filtering is a blunt
include/exclude gate; fit scoring loosened the hard filter and let the
UI lean on ranked sort. (As of the planned step 7.2, those keyword sets
move from global config onto per-profile rows — see below.)

## Build order

- [x] **Step 1 — Bootstrap.** Module loader, DB layer, migration
  runner, SSE bus.
- [x] **Step 2 — Sources + scraper.** Workday adapter, two-phase
  scrape, dedup via `(source_id, external_id)`, scrape-run history.
- [x] **Step 3 — Jobs module + list UI.** Full `/api/jobs/*` surface,
  tags + job_tags tables, Vite/React frontend, `/jobs` page, detail
  drawer.
- [x] **Step 3.1 — Detail-sweep give-up, dual count, stats panel.**
  Resolves a week-long retry loop, makes the filter gap legible, adds
  read-only DB breakdown for diagnostics.
- [x] **Step 4 — Fit scoring v1.** Cheap keyword-based score computed
  at ingestion, the `/refit` endpoint, sort-by-fit on the list view.
- [x] **Step 5 — Master resume + writing samples.** Structured JSON
  resume editor, writing samples for voice calibration, version
  history.
- [x] **Step 6 — Single generation path.** Anthropic adapter, "Generate"
  action on one job, tailored resume + cover letter saved to disk,
  diff in the review UI.
- [x] **Step 7 — Queue + concurrency.** Batch selection, BullMQ worker
  pool, SSE-driven queue status component.
- [x] **Step 7.1 — Multi-user + permissions.** `user_id` on all owned
  tables, scoped repo queries, the `users` registry, `requireRole`
  middleware, and the `/api/users` surface. See `docs/schema-v2.md`
  §16.
- [ ] **Step 7.2 — Profiles.** Per-role-type bundle of filter keywords
  + resume version + writing-sample voice, so one user can run an IT
  search and a stopgap search side by side without clutter. Sources
  belong to a profile; jobs derive their profile through `source_id`.
  Fit-scorer keywords and generation resume/sample selection move from
  global config/flags onto the job's profile. See §17.
- [ ] **Step 7.3 — Manual job entry.** A synthetic per-user
  `platform='manual'` source (attachable to any profile) plus
  `POST /api/jobs/manual`, so profiles without a scrapable ATS — the
  stopgap grocery/retail/food search — can be populated by hand,
  keeping `job → source → profile` universal. See §18.
- [ ] **Step 8 — Ollama adapter + model toggle.** Local generation
  path, UI switch between API and local. Orthogonal to profiles (model
  choice is not a profile attribute).
- [ ] **Step 9 — Notifications.** Browser push and webhook channels,
  fires on queue drained.
- [ ] **Step 10 — Retention.** Sweep cron, pin/unpin, expiry badges,
  retention_runs audit log.
- [ ] **Step 11 — Polish.** Scrape-runs admin view, `/profiles` and
  `/sources` management UI, and **regenerate-with-feedback** — an
  iterative tuning loop on a completed application (a feedback box on
  `/applications/:id`, accumulated steering, versioned non-destructive
  outputs with rollback). See §19. Plus anything left.

## Parked issues — to look at later

- **Authelia re-authenticates every visit.** Hitting
  `hr.cranberrylabs.net` after a session feels like it always prompts
  for credentials again, even within Authelia's expected session
  window. Could be Authelia session config, a cookie domain mismatch
  between subdomains, or Caddy not forwarding the session cookie
  correctly. Not investigated yet — the auth wall works, it just nags
  more than it should. Likely a 15-minute fix once someone sits down
  with it.

_(Resolved: the stale status indicator after application deletion is
fixed as of step 7.1 — the DELETE handler resets the job to
`reviewing`.)_

## Layout

```
cranberrylabs-hr/
├── api/                          Express + module registry
│   ├── src/
│   │   ├── modules/
│   │   │   ├── sources/          source CRUD, scrape trigger
│   │   │   ├── scraper/          Workday adapter, queue worker, sweep
│   │   │   ├── jobs/             list, detail, status, tags, stats, fit-scorer
│   │   │   ├── resume/           master resume + writing samples
│   │   │   ├── applications/     generation queue, doc storage, status
│   │   │   └── users/            registry, roles, requireRole
│   │   ├── middleware/authelia.ts
│   │   ├── services/
│   │   │   ├── db/               better-sqlite3 + migrations
│   │   │   ├── llm/              adapter interface + Anthropic adapter
│   │   │   ├── queue/            BullMQ
│   │   │   └── sse/              SSE bus
│   │   └── server.ts
│   └── package.json
├── web/                          React SPA (Vite)
│   ├── src/
│   │   ├── pages/                JobsPage, applications, resume
│   │   ├── components/           JobList, JobRow, JobDetailDrawer,
│   │   │                         JobStatsPanel, queue + review UI
│   │   └── lib/                  api client, SSE invalidator
│   └── package.json
├── config/
│   ├── default.yaml
│   └── production.yaml
├── data/                         SQLite file (volume)
├── storage/                      Generated docs (volume)
├── deploy/                       UPGRADE-*.md per step
├── docs/
│   ├── schema.md                 v1, original design
│   └── schema-v2.md              authoritative design + build state
├── docker-compose.yml
├── Dockerfile
└── CLAUDE.md
```

## Development

```bash
# API on :3000
cd api && npm run dev

# SPA on :5173, proxies /api to :3000
cd web && npm run dev
```

The dev server doesn't sit behind Authelia. Step 1's `dev_bypass_user`
config makes the middleware accept requests without `Remote-User` when
`NODE_ENV !== 'production'`; the bypass user is seeded as `admin`.

## Deployment

Each step has a corresponding `deploy/UPGRADE-stepN.md` with the exact
rollout steps, verification commands, and rollback procedure. The
standard cycle is:

```bash
git pull
docker compose up -d --build
docker compose logs -f hr
```

Migrations run automatically on boot. `data/` and `storage/` are
mounted volumes — surviving rebuilds.

## Config

`config/production.yaml` (env: `CONFIG_PATH=/app/config/production.yaml`):

- `scraper.filters.target_keywords` — substrings that must match
  title or description for a job to pass the default filter
- `scraper.filters.excluded_keywords` — substrings that disqualify
  a job regardless of include matches
- `scraper.request_delay_ms` — politeness pause between requests
  (default 2000)
- `llm.*` — adapter selection and model/token settings (Anthropic live;
  Ollama planned for step 8)

The frontend respects the same filter via the API. To temporarily
see everything scraped, request `/api/jobs?filter=off`; the
diagnostic panel always shows the unfiltered total alongside the
filtered count.

> Planned change (step 7.2): `scraper.filters` stops being the live
> filter and becomes the seed for each user's default profile. After
> 7.2, keyword sets live on `profiles` rows and are edited via the API,
> not the config file. See `docs/schema-v2.md` §9 and §17.
