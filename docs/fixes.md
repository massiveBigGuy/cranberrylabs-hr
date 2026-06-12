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

## Non-fixes investigated (general audit)

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

---

# Security Audit — 2026-06-12

Findings from a full security audit of the codebase (post-Step-11). Four issues
were fixed; the remainder were investigated and confirmed not exploitable in this
deployment context, with reasoning recorded below.

---

## Security Fix 1 — Path traversal guard on file-serving endpoints

**Files:** `api/src/modules/applications/router.ts`, `api/src/modules/retention/sweep.ts`

The file-serving endpoints resolve stored path column values with `path.resolve(storageRoot, storedPath)` before passing them to `fs.existsSync` or `fs.rmSync`. There was no check that the resolved path remained within `storageRoot`. The path values are written exclusively by server-side code (the worker writes `{appId}/v{n}/cover_letter.txt`) and cannot currently be set by user input, so this was not an active vulnerability — it was a defense-in-depth gap.

**Change:** Added a `withinStorageRoot(storageRoot, filePath)` helper in the router that checks `filePath.startsWith(storageRoot + path.sep)`. Applied at all four file-serving sites and at both file-delete sites in the retention sweep. An out-of-bounds path now returns 400 (serve) or is skipped silently (sweep).

---

## Security Fix 2 — Security headers added to Express

**File:** `api/src/server.ts`

The server did not set any HTTP security headers, leaving the SPA open to MIME-type sniffing and clickjacking.

**Change:** Added an inline middleware that sets five headers on every response:
- `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- `X-Frame-Options: SAMEORIGIN` — prevents clickjacking
- `X-DNS-Prefetch-Control: off` — reduces browser pre-resolution of links
- `Referrer-Policy: strict-origin-when-cross-origin` — limits referrer leakage
- `X-Download-Options: noopen` — IE/Edge: don't auto-open downloads

No external dependency added. CSP was intentionally omitted — it requires knowing all script and style sources for the React SPA and is easy to get wrong; the app is behind Authelia and same-origin, making CSP lower priority.

---

## Security Fix 3 — Startup assertion for dev auth bypass in production

**File:** `api/src/server.ts`

`config.auth.dev_bypass_user` disables Authelia entirely when set — any request missing `Remote-User` is authenticated as the bypass user. If this value is accidentally left in a production config, authentication is completely disabled with no visible warning.

**Change:** Added a startup assertion that throws before the server binds if `dev_bypass_user` is set and `NODE_ENV === 'production'`. The process exits before accepting any requests, making misconfiguration impossible to miss.

---

## Security Fix 4 — Documented direct port exposure in docker-compose.yml

**File:** `docker-compose.yml`

The file's original comment said "No ports are published" while the `ports:` block publishes `3000:3000` to the host — a contradiction. The API is reachable directly on port 3000 on the host, bypassing Caddy/Authelia at the network level. The auth middleware correctly returns 401 for any request missing `Remote-User`, so this is not an auth bypass in practice, but it is an unnecessary exposure.

**Change:** Updated the comment to accurately describe the situation and document the remediation path: if Caddy and the `hr` container are placed on the same Docker network, the `ports:` block can be removed and Caddy can proxy to `http://cranberrylabs-hr:3000` directly.

---

## Security non-fixes investigated

### SSRF via Workday scraper — not exploitable

The scraper calls `tenant_url` values from the DB. The `parseWorkdayUrl()` function validates the hostname against a strict regex (`/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i`) before any network call is made. `localhost`, `192.168.x.x`, `10.x.x.x`, and all other non-Workday hosts fail validation. SSRF is not possible through this surface.

### Repo-level authorization — correct design

The audit flagged that repo methods don't accept a `userId` parameter. This is intentional: the router owns authorization (checks `app.user_id !== req.user.username`), the repo owns data access. Mixing the two would conflate concerns. The pattern is consistent throughout every module.

### Rate limiting — not applicable for this deployment

The app is a single-user homelab behind Authelia. There is no multi-user scenario where one user could abuse expensive operations at another user's expense. If the app were ever shared or publicly exposed, rate limiting on generation and scrape-now endpoints should be added.

### Redis password — network-isolated

Redis is on `cranberrylabs-hr_default`, a private Docker network. No host ports are published for Redis. The only container that can reach it is `hr`. Adding a password would be defense-in-depth but has no current attack vector.

### CSRF — mitigated by browser SOP

The SPA is served from the same origin as the API. State-changing requests require the Authelia session cookie, which the browser attaches automatically only to same-origin requests (Lax/Strict). A cross-origin form POST cannot carry the cookie. No CSRF protection needed beyond what the browser already provides.
