# Planned ATS Adapters — cranberrylabs-hr

Design reference for the three adapters planned after Workday. All three use plain HTTP JSON APIs with no browser automation required. Each adapter fits the existing `probe` / `scrape` / `fetchDetail` interface defined in `api/src/modules/scraper/adapters/types.ts` and registers a new `platform` value recognised by the sources module.

---

## Background & rationale

The Workday adapter covers approximately 32% of US enterprise job postings. Adding Greenhouse, Lever, and Ashby raises that ceiling to roughly 67%, and covers essentially the entire tech/startup segment where IT and infrastructure roles are concentrated. These three were selected because:

- All three expose intentionally public JSON APIs requiring no authentication, no proxy, and no headless browser.
- Greenhouse and Lever are the dominant platforms in the mid-market and high-growth tech space (18% and 12% respectively).
- Ashby is the fastest-growing ATS in tech startups (5%) and is structurally the simplest of the three to implement.
- iCIMS (10%) was evaluated and deferred: its official API is partner-gated, its undocumented career-site endpoint varies by module version, and some instances sit behind Cloudflare. The friction/coverage ratio does not justify building it for a personal tool; manual entry handles the employers that use it.

---

## Shared conventions

All adapters follow the same conventions as the Workday adapter:

- Adapter files live at `api/src/modules/scraper/adapters/{platform}.ts`.
- A new `platform` string constant is added to the platform enum/union wherever `'workday'` is currently referenced.
- The `sources` table `platform` column accepts the new value; the source URL field holds the company slug or board token rather than a full tenant URL.
- Two-phase scraping applies where the listing response does not include full descriptions. Where the listing already includes the full description (Lever, Ashby), the detail sweep is a no-op and `detail_fetch_status` is set to `'ok'` at insert time.
- The existing `request_delay_ms` config and `detail_fetch_attempts` / `detail_fetch_status` give-up logic apply unchanged.

---

## Greenhouse

**Market share:** ~18% of US enterprise postings.  
**API type:** Public JSON (intentionally documented for custom career site builders).  
**Auth required:** None.  
**Two-phase scrape:** Yes — listing returns abbreviated records; descriptions require a per-job detail fetch.

### Listing endpoint

```
GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs
```

Returns a JSON object with a `jobs` array. Each entry includes `id`, `title`, `location.name`, `updated_at`, and an `absolute_url` for applying. It does **not** include the full description text.

The `board_token` is the company slug used in their public job board URL — e.g. `stripe` for `boards.greenhouse.io/stripe`. This is what the user provides when creating a Greenhouse source.

Pagination is not required: the endpoint returns all open jobs for the board in a single response.

### Detail endpoint

```
GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{job_id}
```

Returns the full job object including `content` (HTML description), `departments`, `offices`, and `metadata`. This is fetched by the detail sweep, consistent with the Workday two-phase pattern.

### Field mapping

| Greenhouse field | `jobs` column |
|---|---|
| `id` (integer) | `external_id` (stringified) |
| `title` | `title` |
| `location.name` | `location` |
| `absolute_url` | `url` |
| `content` (HTML, detail phase) | `description` |
| `updated_at` | `posted_date` |
| `departments[0].name` | — (not currently stored) |

### `probe` implementation

`probe` should `GET` the listing endpoint with a small `per_page` or simply check for a non-error response. A 200 with a `jobs` key confirms the board token is valid. A 404 means the token does not exist.

### Notes

- The Greenhouse Boards API explicitly allows scraping of public listings — it is the same endpoint that every company's embedded career page widget calls.
- Some companies configure their Greenhouse instance with a custom domain (`careers.stripe.com`) rather than `boards.greenhouse.io/stripe`, but the board token is the same either way. The source URL field should store the token, not the custom domain.
- Greenhouse does not publish salary data in the Boards API; that field is always null.

---

## Lever

**Market share:** ~12% of US enterprise postings.  
**API type:** Public JSON (officially documented, maintained by Lever for career site builders).  
**Auth required:** None.  
**Two-phase scrape:** No — full description is included in the listing response.

### Listing endpoint

```
GET https://api.lever.co/v0/postings/{company_slug}?mode=json
```

Returns a JSON array. Each element is a complete job posting including `text` (title), `categories` (team, location, commitment, level), `description` and `descriptionPlain` (full HTML and plain-text description), `hostedUrl`, `applyUrl`, `createdAt`, and an optional `salaryRange`.

All published postings are returned in a single response — no pagination. Because the full description is included in the listing, the detail sweep is a no-op for Lever jobs: `detail_fetch_status` is set to `'ok'` at insert time and the sweep skips them.

There is also an EU instance at `api.eu.lever.co` for companies whose data residency is in the EU. The adapter should detect this from the source URL or allow the user to specify the region.

### Field mapping

| Lever field | `jobs` column |
|---|---|
| `id` (UUID string) | `external_id` |
| `text` | `title` |
| `categories.location` | `location` |
| `hostedUrl` | `url` |
| `descriptionPlain` (preferred) or stripped `description` | `description` |
| `createdAt` (Unix ms timestamp) | `posted_date` |
| `categories.team` | — (not currently stored) |
| `categories.commitment` | `remote_type` (map `'Remote'` → `'remote'`, etc.) |
| `salaryRange.min` / `.max` / `.currency` | `salary_min` / `salary_max` / `salary_currency` |

### `probe` implementation

`probe` should `GET` the listing endpoint and verify the response is a JSON array (even an empty one). A 404 or a non-array response means the slug is invalid.

### Notes

- Lever explicitly states in its GitHub documentation that all published postings are publicly viewable and may be scraped by third parties.
- The `descriptionPlain` field is preferred over stripping HTML from `description` — it is already clean text and avoids the need for an HTML parser in the adapter.
- `createdAt` is a Unix millisecond timestamp; convert to ISO 8601 before storing.
- Lever does not expose a `lastmod` or `updatedAt` on individual postings through the public API, so change detection relies on the existing `description_hash` column rather than a timestamp comparison.

---

## Ashby

**Market share:** ~5% of US enterprise postings; fastest-growing ATS in tech startups.  
**API type:** Public JSON (undocumented but stable; same endpoint the hosted job board uses).  
**Auth required:** None.  
**Two-phase scrape:** No — full description is included in the listing response.

### Listing endpoint

```
POST https://api.ashbyhq.com/posting-api/job-board/{company_slug}
Content-Type: application/json

{}
```

Returns a JSON object with a `jobs` array. Each entry includes `id`, `title`, `location`, `employmentType`, `isRemote`, `publishedDate`, `descriptionHtml`, `descriptionPlain`, and `applyUrl`. Full descriptions are included in the listing, so no detail sweep is needed; `detail_fetch_status` is set to `'ok'` at insert time.

Note the endpoint uses `POST` with an empty JSON body, not `GET`. This is Ashby's published pattern for their job board API and is consistent across all tenants.

### Field mapping

| Ashby field | `jobs` column |
|---|---|
| `id` (UUID string) | `external_id` |
| `title` | `title` |
| `location` (string) | `location` |
| `applyUrl` | `url` |
| `descriptionPlain` (preferred) or stripped `descriptionHtml` | `description` |
| `publishedDate` (ISO 8601) | `posted_date` |
| `employmentType` | — (not currently stored) |
| `isRemote` (boolean) | `remote_type` (map `true` → `'remote'`) |

### `probe` implementation

`probe` should POST to the listing endpoint with an empty body. A 200 with a `jobs` key confirms the slug is valid. A 404 means the slug does not exist or the company does not use Ashby.

### Notes

- The Ashby endpoint is undocumented but has been stable across the community tooling that uses it. It is the same endpoint their hosted `jobs.ashby.io/{slug}` page calls.
- The `company_slug` is the identifier used in `jobs.ashby.io/{slug}` URLs — e.g. `linear` for `jobs.ashby.io/linear`.
- Ashby's `isRemote` field is a boolean; the `remote_type` column stores a string. Map `true` → `'remote'`, `false` → `null` (location is already captured separately).
- Some Ashby boards return a `compensation` object with `min`, `max`, and `currency`; map these to `salary_min`, `salary_max`, `salary_currency` when present.

---

## Build order

The recommended build sequence is Ashby → Lever → Greenhouse:

1. **Ashby** — structurally the simplest: single POST, full descriptions in listing, no detail sweep. Good for validating the multi-ATS adapter pattern with minimal moving parts.
2. **Lever** — similar simplicity (single GET, no detail sweep), adds the EU region handling and the Unix timestamp conversion.
3. **Greenhouse** — adds the two-phase detail sweep, consistent with the existing Workday pattern but simpler URL structure.

All three can be built without schema changes. The only addition required before building the first adapter is the `platform` value registration in the sources module and any adapter-dispatch logic that currently hardcodes `'workday'`.

---

## Cross-source deduplication note

Cross-source dedup (preventing duplicate rows when the same job appears across multiple ATS platforms during an employer migration) is handled via the existing `description_hash` column. This was patched ahead of the adapter builds and requires no further work here.

---

## Out of scope

- **iCIMS** — partner-gated official API; undocumented per-instance endpoint with variable JSON shape; Cloudflare exposure on some instances. Not worth building for a personal tool; manual entry covers the employers that matter.
- **SmartRecruiters, Workable, BambooHR** — appear in the community tooling but are outside the coverage sweet spot for IT/infrastructure search. Revisit if manual entry friction signals otherwise.
- **LinkedIn / Indeed** — hostile ToS for scraping, aggressive anti-bot systems, explicitly out of scope per `CLAUDE.md`.
- **Browser automation (Playwright/Puppeteer)** — explicitly avoided; adds ~300MB to the container image for marginal coverage gains.
