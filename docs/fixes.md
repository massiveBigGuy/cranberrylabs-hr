# Code Review Fixes — 2026-06-12

Findings from a post-Step-11 codebase audit. Four issues were confirmed and fixed;
two additional findings (generation_notes schema debt, ORDER BY tiebreaker) were
investigated and left as-is.

---

## Fix 1 — Dead variable in retention sweep

**File:** `api/src/modules/retention/sweep.ts`

`const skipped = 0` was declared but never incremented. It was being passed as
`apps_skipped_pinned` to the run record and logged, making the metric appear
meaningful when it is structurally always zero. The `findPurgeCandidates` query
filters pinned applications out upfront via `WHERE pinned_at IS NULL`, so nothing
is ever "skipped" — pinned apps simply don't appear as candidates.

**Change:** Removed the variable. Both `finishRun` calls and the log line now use the
literal `0`. The `apps_skipped_pinned` column in `retention_runs` is kept in the
schema for future use if skip counting is ever added.

---

## Fix 2 — Duplicate code across LLM adapters

**Files:** `api/src/services/llm/anthropic.ts`, `api/src/services/llm/ollama.ts`

Three items were copy-pasted identically into both adapters during Step 11:
`SYSTEM_PROMPT`, `buildFeedbackBlock()`, and `extractTag()`. Any change to the
prompt or parsing logic had to be made in two places.

**Change:** Extracted all three to `api/src/services/llm/utils.ts` and updated
both adapters to import from there. The adapter files now contain only the
adapter-specific networking/SDK code.

---

## Fix 3 — Missing `profile` from `JobDetailResponse` type

**File:** `web/src/lib/api.ts`

`GET /api/jobs/:id` returns `{ job, tags, profile }` but the frontend type
`JobDetailResponse` only declared `{ job, tags }`. The `profile` field was silently
discarded by TypeScript — any future frontend code accessing `response.profile`
would not have been type-checked.

**Change:** Added `profile: Profile | null` to `JobDetailResponse`.

---

## Fix 4 — Silent error in async SSE event handler

**File:** `api/src/modules/notifications/index.ts`

`bus.on('event', async ...)` awaited `service.sendQueueDrained()` without a
try-catch. Node's EventEmitter does not propagate errors from async listeners —
a failed webhook or push delivery would be silently swallowed, with no log line
to diagnose it.

**Change:** Wrapped `sendQueueDrained` in try-catch; errors are now logged at
`error` level with the message.

---

## Non-fixes investigated

### `generation_notes` field always null

The column exists in both `applications` and `application_versions` (and in both
tables' TypeScript interfaces), but nothing in the worker or generator writes to it.
It has always been null. Since migrations are append-only the column cannot be
dropped; the field is reserved for future use (e.g. storing token counts or a
brief model-generated summary of changes). No action taken.

### ORDER BY tiebreaker in jobs list

The audit suggested the jobs list query lacked a tiebreaker. Investigation showed
`jobs/repo.ts` already uses `id DESC` as the final sort key on both sort paths.
No action needed.
