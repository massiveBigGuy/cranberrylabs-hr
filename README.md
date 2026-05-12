# cranberrylabs-hr

Standalone job-discovery, tailored-document-generation, and application-tracking service.
Lives at `hr.cranberrylabs.net`. Isolated from `cranberrylabs-api` and `cranberrylabs-web`
— separate code, separate database, separate container. I really need a job.

See [`docs/schema.md`](docs/schema.md) for the full design.

## Layout

```
api/        Express + module registry, SQLite, BullMQ workers
web/        React SPA (added in a later step)
config/     YAML config (default + production)
data/       SQLite file (gitignored)
storage/    Generated resumes and cover letters (gitignored)
```

## Current state — Step 1 of the build order

This iteration scaffolds:

- Repo + workspace layout matching §15 of the schema.
- API `package.json` with TypeScript, Express, `better-sqlite3`, BullMQ, config loader.
- Module loader (`src/modules/registry.ts`) that walks a registry array and mounts
  each module's router, runs its migrations, registers its workers, schedules its
  cron tasks. Currently the registry is empty — modules slot in over the next steps.
- Migrations runner (`src/services/db/migrations.ts`) with a `schema_migrations`
  tracking table and idempotent application.
- SSE endpoint (`/api/events`) emitting heartbeats every 15s — verifies the live-update
  pipe before any module needs it.
- A `sources` module stub that demonstrates the module contract end-to-end without
  doing real work yet.

Nothing scrapes, nothing generates. The skeleton compiles and runs.

## Quickstart

```bash
cd api
npm install
npm run dev
# in another shell:
curl http://localhost:3000/health
curl -N http://localhost:3000/api/events    # SSE heartbeats
```
