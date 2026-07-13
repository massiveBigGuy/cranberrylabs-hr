# cranberrylabs-hr

Personal job-search automation. Scrapes career pages, filters, tags,
and fit-scores discovered postings, and drives LLM-assisted resume and
cover-letter generation. Human-in-the-loop by design — no
auto-submission.

Runs as an isolated service on the homelab at `hr.cranberrylabs.net`,
behind Caddy + Authelia. Separate code, separate database, and
separate Redis from `cranberrylabs-api` and `cranberrylabs-web`. The
existing site links to it but shares nothing with it.

## Current state — update 3 patch 2 complete

The full pipeline is live: discover → fit-score → generate → review →
iterate with feedback → submit (by hand). All nine modules are
registered and running. From a fresh clone:

```bash
docker compose up -d --build
```

…brings up the API, the SPA, Redis (BullMQ queues), the cron-driven
detail sweep, and the nightly retention sweep. After authenticating
through Authelia you have access to all pages described below.

### What works

- **Sources management** — Workday, Greenhouse, Lever, and Ashby
  sources registered and managed from `/sources` via a platform
  selector; each can be enabled, disabled, manually triggered, and its
  scrape-run history inspected. Each source belongs to a profile, which
  is how jobs inherit their profile.
- **Multi-ATS scraping** — four adapters behind one interface
  (`ScraperAdapter`). Workday and Greenhouse are two-phase: a queued
  listing pass discovers postings, then an hourly cron sweep fetches
  each posting's full description. Lever and Ashby are one-phase: the
  listing response already includes the full description, so those
  jobs are ready immediately with no sweep step.
- **Detail-sweep give-up** — jobs the sweep can't fetch after 5
  consecutive failures are flipped to `detail_fetch_status = 'gave_up'`
  and excluded from future runs.
- **Cross-source duplicate detection** — the same posting discovered
  through two different ATS sources (an employer migrating platforms
  mid-search) is flipped to `status = 'duplicate'` once both copies
  have a computed `description_hash`. Runs from the detail sweep for
  two-phase adapters (Workday, Greenhouse) and at insert time for
  one-phase adapters (Lever, Ashby), which never pass through the
  sweep.
- **Jobs API + UI** — `/jobs` with status, date, source, profile, tag,
  fit, and search filters; dual "X of Y jobs" count; collapsible
  "Database breakdown" stats panel; detail drawer with status/dismiss/
  tag/hiring-manager actions.
- **Fit scoring** — deterministic keyword-based score computed at
  ingestion using the job's profile's keyword sets. `POST
  /api/jobs/:id/refit` recomputes one job; the list view sorts by fit
  descending by default (`?sort=fit`).
- **Master resume + writing samples** — structured JSON resume with
  version history; writing samples for cover-letter voice calibration.
  Both are scoped per user and per profile.
- **Profiles** — per-role-type bundles at `/profiles`. Each profile
  carries its own filter keyword set, a pinned resume version, and a
  set of writing samples. Sources are assigned to a profile; jobs
  derive their profile through their source. Fit scoring and generation
  both resolve inputs from the job's profile rather than global flags.
  `POST /api/profiles/:id/refit` rescores every job in a profile after
  a keyword change.
- **Manual job entry** — `POST /api/jobs/manual` adds a posting by
  hand against a synthetic per-user "Manual entry" source. Useful for
  postings found outside Workday (word of mouth, one-off careers pages,
  or platforms without an adapter). Keeps `job → source → profile`
  universal.
- **Generation — Anthropic + Ollama** — "Generate" on a job (single or
  batch) enqueues a BullMQ worker. The generate dialog lets you choose
  the adapter (Anthropic or Ollama) and optionally override the system
  prompt. The worker resolves the resume version and writing samples
  from the job's profile, then produces a tailored resume + cover
  letter saved to disk. `POST /api/applications` returns 202; SSE
  streams progress.
- **Regenerate with feedback** — a completed application can be
  regenerated with optional steering text ("emphasise Kubernetes",
  "shorten to 3 paragraphs"). Each successful generation writes a
  versioned output; the version history panel lets you download any
  version or roll back by activating a prior one. Non-destructive:
  a failed regeneration never overwrites the current good draft.
- **Saved system prompts** — named, reusable system-prompt overrides
  managed at `/prompts`. The generate and regenerate dialogs each have
  a selector to load a saved prompt or edit inline and save it on the
  spot. Prompts are per-user and scoped to the applications module.
- **Queue + concurrency** — batch-select multiple jobs; generation runs
  in a BullMQ worker pool (3 attempts for transient LLM failures) with
  SSE-driven queue-status progress.
- **Multi-user + permissions** — every owned table is scoped by the
  Authelia `Remote-User`. A `users` registry with `admin` / `user` /
  `viewer` roles is enforced by `requireRole`; users are
  auto-provisioned on first authenticated request. Tags stay global (a
  shared vocabulary); everything else is per-owner.
- **Notifications** — browser push subscriptions via Web Push API
  (`/api/notifications/subscribe`). Fires on `queue.drained` when all
  in-flight generations complete. The notification bell in the header
  manages subscribe/unsubscribe; VAPID keys are configured in
  `production.yaml`.
- **Retention** — nightly sweep at 2 AM purges `ready` and `applied`
  applications past their retention window. Default policy: 7 days.
  `keep-30d` and `forever` policies are pre-seeded. Applications can be
  pinned to exempt them from the sweep. `POST /api/applications/:id/pin`
  and `DELETE /api/applications/:id/pin` toggle the pin;
  `PATCH /api/applications/:id/policy` assigns a named policy.
- **Live updates** — SSE on `/api/events` pushes scrape, queue, and
  retention events; the frontend invalidates React Query caches on
  receipt so new jobs and generation results land without a refresh.
- **Authelia integration** — `autheliaIdentity` middleware sits in
  front of every API route; requests without `Remote-User` are
  rejected. Caddy's `forward_auth` enforces this at the reverse proxy.


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
- [x] **Step 7.2 — Profiles.** Per-role-type bundle of filter keywords
  + resume version + writing-sample voice, so one user can run an IT
  search and a stopgap search side by side without clutter. Sources
  belong to a profile; jobs derive their profile through `source_id`.
  Fit-scorer keywords and generation resume/sample selection move from
  global config/flags onto the job's profile. See §17.
- [x] **Step 7.3 — Manual job entry.** A synthetic per-user
  `platform='manual'` source (attachable to any profile) plus
  `POST /api/jobs/manual`, so profiles without a scrapable ATS can be
  populated by hand, keeping `job → source → profile` universal.
  See §18.
- [x] **Step 8 — Ollama adapter + model toggle.** Local generation
  path, adapter selector in the generate dialog. Orthogonal to profiles
  (model choice is not a profile attribute).
- [x] **Step 9 — Notifications.** Browser push via Web Push API,
  webhook channels, fires on `queue.drained`.
- [x] **Step 10 — Retention.** Nightly sweep cron (2 AM), pin/unpin,
  named policies (`default`/`keep-30d`/`forever`), retention runs and
  events audit log.
- [x] **Step 11 — Polish.** `/sources` and `/profiles` management UI,
  scrape-run history visible in Sources, **regenerate-with-feedback**
  (feedback textarea on completed applications, accumulated steering,
  versioned non-destructive outputs with version-history panel and
  rollback), and **saved system prompts** (named reusable prompt
  overrides managed at `/prompts`, selectable in generate + regenerate
  dialogs). See §19.
- [x] **Step 12 — ATS adapters: Greenhouse, Lever, Ashby.** Three new
  scraper adapters alongside Workday, raising ATS coverage from ~32%
  to ~67% (design reference: `docs/update-1.md`). Greenhouse is
  two-phase like Workday; Lever and Ashby are one-phase (full
  description in the listing response). Platform selector added to
  `/sources`. Closed a gap in the cross-source dedup patch where
  one-phase jobs never reached the sweep-side duplicate check — see
  `docs/schema-v2.md` §3.


## Layout

```
cranberrylabs-hr/
├── api/                          Express + module registry
│   ├── src/
│   │   ├── modules/
│   │   │   ├── sources/          source CRUD, scrape trigger
│   │   │   ├── scraper/          Workday/Greenhouse/Lever/Ashby adapters,
│   │   │   │                     queue worker, detail sweep
│   │   │   ├── jobs/             list, detail, status, tags, stats, fit-scorer
│   │   │   ├── resume/           master resume + writing samples
│   │   │   ├── applications/     generation queue, doc storage, versions,
│   │   │   │                     saved system prompts
│   │   │   ├── users/            registry, roles, requireRole
│   │   │   ├── profiles/         per-role-type keyword + resume + voice bundles
│   │   │   ├── notifications/    browser push (Web Push API) + webhooks
│   │   │   └── retention/        nightly sweep, pin/unpin, named policies
│   │   ├── middleware/authelia.ts
│   │   ├── services/
│   │   │   ├── db/               better-sqlite3 + migrations
│   │   │   ├── llm/              adapter interface, Anthropic + Ollama adapters
│   │   │   ├── queue/            BullMQ
│   │   │   └── sse/              SSE bus
│   │   └── server.ts
│   └── package.json
├── web/                          React SPA (Vite)
│   ├── src/
│   │   ├── pages/                JobsPage, ApplicationsPage, ResumePage,
│   │   │                         SourcesPage, ProfilesPage, PromptsPage
│   │   ├── components/           JobList, JobRow, JobDetailDrawer,
│   │   │                         JobStatsPanel, GenerateModal, queue +
│   │   │                         review + version-history UI
│   │   └── lib/                  api client, SSE invalidator, push
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

- `scraper.filters.target_keywords` / `excluded_keywords` — used only
  as the **seed** when the step 7.2 migration creates a user's default
  profile. After first boot, keyword sets live on `profiles` rows and
  are edited via the API (`PATCH /api/profiles/:id`), not the config
  file.
- `scraper.request_delay_ms` — politeness pause between requests
  (default 2000).
- `llm.default_adapter` — `anthropic` or `ollama`; the generate dialog
  overrides this per-request.
- `llm.anthropic.*` / `llm.ollama.*` — model name and token settings
  for each adapter.
- `notifications.on_queue_complete` — set `true` to fire notifications
  when the generation queue drains.
- `notifications.channels` — list of webhook channel objects
  (`{ type: "webhook", url: "..." }`).
- `notifications.vapid.*` — VAPID public/private keys for browser push
  (generate once with `npx web-push generate-vapid-keys`).

To temporarily see all scraped jobs regardless of keyword filter, use
`/api/jobs?filter=off`; the diagnostic panel always shows the
unfiltered total alongside the filtered count.
