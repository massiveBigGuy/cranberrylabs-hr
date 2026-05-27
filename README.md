# cranberrylabs-hr

Personal job-search automation. Scrapes career pages, filters and tags
discovered postings, and (in a future step) drives LLM-assisted resume
and cover-letter generation. Human-in-the-loop by design — no
auto-submission.

Runs as an isolated service on the homelab at `hr.cranberrylabs.net`,
behind Caddy + Authelia. Separate code, separate database, and
separate Redis from `cranberrylabs-api` and `cranberrylabs-web`. The
existing site links to it but shares nothing with it.

## Current state — end of step 3.1

The data pipeline and the first UI layer are working. From a fresh
clone:

```bash
docker compose up -d --build
```

…brings up the API, the SPA, Redis (for the BullMQ scrape queue), and
the cron-driven detail sweep. After authenticating through Authelia,
`hr.cranberrylabs.net/jobs` shows discovered postings with filters and
a detail drawer.

### What works

- **Sources management** — Workday tenant URLs registered via
  `POST /api/sources`; each can be enabled, disabled, manually
  triggered, and inspected via `GET /api/sources/:id/runs`.
- **Two-phase scraping** — a queued listing pass discovers postings
  via Workday's JSON API; an hourly cron sweep fetches each posting's
  full description.
- **Detail-sweep give-up** — jobs the sweep can't fetch after 5
  consecutive failures are flipped to `detail_fetch_status = 'gave_up'`
  and excluded from future runs. Stops the retry-loop noise we hit
  with two GM postings.
- **Jobs API** — `GET /api/jobs` with status, date, source, tag, and
  search filters; per-job tag attach/detach; dismiss with reason;
  hiring-manager edit. `POST /api/jobs/:id/refit` is a 501 stub until
  step 4 lands.
- **Stats endpoint** — `GET /api/jobs/stats` returns aggregate counts
  (scraped total, by-status distribution, keyword-filter pass/fail,
  detail-fetch state) backing the diagnostic panel.
- **Frontend** — Vite + React + React Query + Tailwind. `/jobs` page
  with date filter (24h / 7d / 30d / All), title/company search, the
  dual count ("X of Y jobs"), and a collapsible "Database breakdown"
  panel that explains the filter gap. The detail drawer supports
  status transitions, dismiss with reason, free-form tags, and links
  to the company posting.
- **Live updates** — SSE on `/api/events` pushes `scrape.completed`
  and `job.discovered`; the frontend invalidates React Query caches
  on receipt, so new jobs land without a refresh.
- **Authelia integration** — `autheliaIdentity` middleware sits
  in front of every API route; requests without `Remote-User` are
  rejected. Caddy's `forward_auth` enforces this at the reverse
  proxy.

### Observed at this point

Snapshot of the deployed system as of end of step 3.1:

- 845 jobs in the database
- 843 with descriptions, 2 marked `gave_up` (GM postings 322 and 327
  — Workday returns 403 on those specific URLs)
- 25 visible in the default Jobs view; 820 filtered by the configured
  `target_keywords` / `excluded_keywords` (sysadmin / IT / field-tech
  oriented vs. GM's mostly ML/AI infrastructure roles)

The 25/845 gap is the strongest signal that step 4 (fit scoring) is
what's actually needed next — keyword filtering is a blunt include/
exclude gate, and once `fit_score` exists the hard filter can loosen
and the UI can lean on ranked sort instead.

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
- [ ] **Step 4 — Fit scoring v1.** Cheap keyword-based score computed
  at ingestion, the `/refit` endpoint, sort-by-fit on the list view.
- [ ] **Step 5 — Master resume + writing samples.** Structured JSON
  resume editor, writing samples for voice calibration, version
  history.
- [ ] **Step 6 — Single generation path.** Anthropic adapter, "Generate"
  action on one job, tailored resume + cover letter saved to disk.
- [ ] **Step 7 — Queue + concurrency.** Batch selection, BullMQ worker
  pool, SSE-driven queue status component.
- [ ] **Step 8 — Ollama adapter + model toggle.** Local generation
  path, UI switch between API and local.
- [ ] **Step 9 — Notifications.** Browser push and webhook channels,
  fires on queue drained.
- [ ] **Step 10 — Retention.** Sweep cron, pin/unpin, expiry badges,
  retention_runs audit log.
- [ ] **Step 11 — Polish.** Scrape-runs admin view, regenerate-with-
  feedback button, anything left.

## Parked issues — to look at later

Items that aren't blocking but should be revisited:

- **Authelia re-authenticates every visit.** Hitting
  `hr.cranberrylabs.net` after a session feels like it always prompts
  for credentials again, even within Authelia's expected session
  window. Could be Authelia session config, a cookie domain
  mismatch between subdomains, or Caddy not forwarding the session
  cookie correctly. Not investigated yet — the auth wall works, it
  just nags more than it should. Likely a 15-minute fix once
  someone sits down with it.

- **The `node:timers/promises` import shows an IDE error on the dev
  PC.** TypeScript can't find `@types/node` in the local workspace
  because nothing Node-related is installed on the dev machine. The
  Docker build has it and compiles fine. Cosmetic until someone wants
  to run typecheck on the host.

- **GM postings 322 and 327 are permanently `gave_up`.** Workday
  returns 403 on those specific detail URLs. They appear in the
  list with no description — the drawer's existing fallback covers
  it. If a "retry detail fetch" button is ever wanted, the path is:
  reset `detail_fetch_attempts = 0, detail_fetch_status = 'pending'`
  on the row; no schema change needed.

- **Result-count duplication on the Jobs page.** The dual count
  ("25 of 845 jobs") and the older "25 jobs matching" line are both
  rendering. One block in `web/src/pages/JobsPage.tsx` needs to be
  removed — keep the "X of Y" version, drop the "matching" version.

## Layout

```
cranberrylabs-hr/
├── api/                          Express + module registry
│   ├── src/
│   │   ├── modules/
│   │   │   ├── sources/          source CRUD, scrape trigger
│   │   │   ├── scraper/          Workday adapter, queue worker, sweep
│   │   │   └── jobs/             list, detail, status, tags, stats
│   │   ├── middleware/authelia.ts
│   │   ├── services/
│   │   │   ├── db/               better-sqlite3 + migrations
│   │   │   ├── queue/            BullMQ
│   │   │   └── sse/              SSE bus
│   │   └── server.ts
│   └── package.json
├── web/                          React SPA (Vite)
│   ├── src/
│   │   ├── pages/JobsPage.tsx
│   │   ├── components/           JobList, JobRow, JobDetailDrawer,
│   │   │                         JobStatsPanel
│   │   └── lib/                  api client, SSE invalidator
│   └── package.json
├── config/
│   ├── default.yaml
│   └── production.yaml
├── data/                         SQLite file (volume)
├── storage/                      Generated docs (volume, used from step 6)
├── deploy/                       UPGRADE-*.md per step
├── docker-compose.yml
└── Dockerfile
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
`NODE_ENV !== 'production'`.

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

The frontend respects the same filter via the API. To temporarily
see everything scraped, request `/api/jobs?filter=off`; the
diagnostic panel always shows the unfiltered total alongside the
filtered count.
