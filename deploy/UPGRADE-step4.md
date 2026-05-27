# UPGRADE — Step 4: Fit Scoring v1

## What's new

- **`api/src/modules/jobs/fit-scorer.ts`** — deterministic keyword scorer.
  Title match = +0.5, description-only match = +0.15, any excluded keyword
  → score 0. Capped at 1.0. Reasons stored as JSON array in `fit_reasons`.
- **Startup backfill** — on boot, the jobs module scores every job that has
  a description but no `fit_score`. ~843 rows takes < 10 ms; nothing to run
  manually.
- **Ingestion scoring** — the detail sweep now scores each job immediately
  after fetching its description. New jobs arriving after this deploy will
  have scores from the first sweep run.
- **`POST /api/jobs/:id/refit`** — previously a 501 stub, now recomputes the
  fit score for a single job on demand.
- **Sort by fit** — `GET /api/jobs` defaults to `?sort=fit` (scored jobs
  ranked highest). Pass `?sort=date` for the legacy date-only order.
- **Frontend** — "Fit" column in the jobs table showing `N%` (green ≥ 50%,
  yellow 15–49%, dash for null/0). Sort toggle (Fit / Date) in the filter bar.

No schema migrations — `fit_score` and `fit_reasons` columns already exist
from step 2; they were just always NULL until now.

## Rollout

```bash
cd ~/cranberrylabs-hr
git pull
docker compose up -d --build
docker compose logs -f hr
```

### Expected startup log lines

```
INFO [jobs] fit backfill: starting {"count": 843}
INFO [jobs] fit backfill: complete {"scored": 843}
INFO [jobs] jobs module initialized
INFO [server] listening on :3000
```

If `count` is 0, all jobs were already scored (re-deploy scenario) — that's fine.

## Verification

### Check scores landed

```bash
sqlite3 data/hr.db \
  "SELECT COUNT(*) as scored, AVG(fit_score) as avg_fit FROM jobs WHERE fit_score IS NOT NULL;"
```

Expect `scored` ≈ 843 (all jobs with descriptions), `avg_fit` somewhere in
the 0.1–0.4 range depending on keyword coverage.

### Top 10 by fit score

```bash
sqlite3 data/hr.db \
  "SELECT title, company, fit_score, fit_reasons FROM jobs ORDER BY fit_score DESC LIMIT 10;"
```

### List endpoint with fit sort

```bash
curl -s 'http://localhost:3000/api/jobs?sort=fit&limit=5' \
  | jq '[.jobs[] | {title, fit_score}]'
```

Jobs should appear with the highest `fit_score` first.

### Refit a single job

```bash
# Pick any job id with a description, e.g. id=1
curl -s -X POST http://localhost:3000/api/jobs/1/refit \
  | jq '{fit_score, fit_reasons}'
```

Should return the recomputed score, not a 501.

### Sort toggle in UI

Visit `hr.cranberrylabs.net/jobs` — the filter bar should show "Sort: Fit | Date"
buttons. The Fit column should show coloured percentages or dashes.

## Rollback

No schema change was made, so rolling back is just reverting the deploy:

```bash
git checkout <previous-commit>
docker compose up -d --build
```

The `fit_score` values written during this deploy will remain in the database
but are harmless — the old code ignores them, and the backfill would re-run
on the next forward-deploy anyway.
