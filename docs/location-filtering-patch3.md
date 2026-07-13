# Location Filtering — cranberrylabs-hr

Design document for structured geographic filtering on the `jobs` table. Covers schema changes, normalisation logic, remote job handling, filter UI, and API surface.

---

## Problem

The `jobs.location` column stores whatever free-text string each ATS returned at scrape time. Formats vary widely across platforms and even across employers on the same platform:

- `"Detroit, MI, US"`
- `"NYC"`
- `"East Coast"`
- `"Remote - US Only"`
- `"Hybrid - Greater Toronto Area"`
- `"Mexico City, Distrito Federal, Mexico"`
- `"LATAM"`

Filtering by geography against this column means pattern-matching against uncontrolled free text — brittle, full of edge cases (`"MI"` matching `"Miami"`), and unable to express the kind of multi-region filter the user actually wants without writing a forest of `LIKE` clauses.

---

## Design decisions

**1. Parse into structured columns at ingest, preserve the raw string.**
Three new columns — `location_country`, `location_state`, `location_city` — are populated by a normaliser that runs when a job is inserted or when the detail sweep writes a description. The raw `location` column is retained unchanged and remains the display value in the UI.

**2. Remote jobs are exempt from geographic parsing.**
If `remote_type` is non-null and non-empty at parse time, the normaliser skips geographic extraction and leaves `location_country`, `location_state`, and `location_city` as null. Remote is its own category; location text on a remote posting is noise. Filtering for remote jobs uses a dedicated `include_remote` boolean on the filter, completely separate from the geographic filter.

**3. Continent is a UI grouping, not a stored field.**
There is no `location_continent` column. Continents are groupings of countries rendered in the filter panel for convenience — collapsing "North America" expands into US, Canada, Mexico checkboxes. Nothing about continent is stored or queried; the SQL always operates at country + state level.

**4. Location filters are profile-level preferences, not ad-hoc query params.**
Allowed countries and states are stored on the `profiles` table as JSON arrays alongside the existing keyword sets. This makes location filtering a first-class part of the profile bundle — the IT profile might allow US + Canada, the stopgap profile might allow only specific states. The `GET /api/jobs` query param `?location_filter=off` bypasses it for diagnostic purposes, mirroring the existing `?filter=off` for keyword filtering.

**5. Null location is not excluded by default.**
Jobs where the normaliser could not extract a country (ambiguous strings like `"East Coast"`, `"LATAM"`, `"Multiple Locations"`) are stored with null structured columns. The filter treats null location as a separate bucket — the user can choose to include or exclude unresolvable locations. Default is include, so novel location strings don't silently drop jobs.

---

## Schema changes

### `jobs` table — new columns via `scraper_005_location_parsed`

```sql
ALTER TABLE jobs ADD COLUMN location_country TEXT;   -- ISO 3166-1 alpha-2: "US", "CA", "MX", null
ALTER TABLE jobs ADD COLUMN location_state   TEXT;   -- ISO 3166-2 subdivision code: "MI", "ON", "MOR", null
ALTER TABLE jobs ADD COLUMN location_city    TEXT;   -- normalised city name, null

CREATE INDEX idx_jobs_location ON jobs(location_country, location_state);
```

Country is stored as ISO 3166-1 alpha-2 (`"US"`, `"CA"`, `"MX"`). State/province is stored as the ISO 3166-2 subdivision code without the country prefix (`"MI"` not `"US-MI"`, `"ON"` not `"CA-ON"`, `"MOR"` for Morelos not `"MX-MOR"`). City is stored as a normalised string (trimmed, consistent casing) primarily for display purposes — filtering operates at country + state level, not city level.

All three columns are nullable. Null means the normaliser could not confidently parse that level of detail from the raw string.

### `profiles` table — new columns via `profiles_002_location_filter`

```sql
ALTER TABLE profiles ADD COLUMN allowed_countries  TEXT;  -- JSON string[]: ["US","CA"] or null = allow all
ALTER TABLE profiles ADD COLUMN allowed_states      TEXT;  -- JSON string[]: ["MI","ON","QC"] or null = allow all within allowed countries
ALTER TABLE profiles ADD COLUMN include_remote      INTEGER NOT NULL DEFAULT 1;  -- 1 = remote jobs pass the filter
ALTER TABLE profiles ADD COLUMN include_null_location INTEGER NOT NULL DEFAULT 1;  -- 1 = unresolvable locations pass
```

`allowed_countries` null means no country restriction. `allowed_states` null means no state restriction within the allowed countries (i.e. all states of allowed countries pass). Both are JSON string arrays when set.

The combination works as follows:
- If `allowed_countries` is null → country filter is off; fall through to state check.
- If `allowed_countries` is set and the job's `location_country` is not in it → exclude (unless `include_null_location` catches a null country).
- If `allowed_states` is null → any state within the allowed country passes.
- If `allowed_states` is set and the job's `location_state` is not in it → exclude.

The filter logic is OR'd with remote and null-location buckets:

```
PASS if:
  (remote_type IS NOT NULL AND include_remote = 1)
  OR (location_country IS NULL AND include_null_location = 1)
  OR (
    (allowed_countries IS NULL OR location_country IN (...))
    AND (allowed_states IS NULL OR location_state IN (...))
  )
```

---

## Normaliser

A pure function `parseLocation(raw: string, remoteType: string | null): ParsedLocation` in `api/src/modules/scraper/location-parser.ts`.

```typescript
interface ParsedLocation {
  country: string | null;   // ISO 3166-1 alpha-2
  state:   string | null;   // ISO 3166-2 subdivision code (no country prefix)
  city:    string | null;
}
```

### Logic

**Step 1 — Remote check.**
If `remoteType` is non-null and non-empty, return `{ country: null, state: null, city: null }` immediately. No further parsing.

**Step 2 — Tokenise.**
Split `raw` on commas and trim each token. Most ATS location strings follow `"City, State, Country"` or `"City, State"` or `"State, Country"` ordering.

**Step 3 — Country detection.**
Scan tokens from right to left for a country match against a lookup table. The lookup covers:
- Full names: `"United States"`, `"United States of America"`, `"Canada"`, `"Mexico"`, `"United Kingdom"`, etc.
- ISO alpha-2 codes: `"US"`, `"CA"`, `"MX"`, `"GB"`, etc.
- Common abbreviations: `"USA"`, `"U.S."`, `"U.S.A."`

If a match is found, record the country code and remove that token from further processing.

**Step 4 — State/province detection.**
Scan remaining tokens for a state/province match. The lookup covers:
- US states: all 50 full names + two-letter abbreviations (e.g. `"Michigan"` → `"MI"`, `"MI"` → `"MI"`)
- Canadian provinces/territories: all 13 full names + two-letter codes (e.g. `"Ontario"` → `"ON"`, `"Nova Scotia"` → `"NS"`)
- Mexican states: all 31 full names + INEGI codes (e.g. `"Morelos"` → `"MOR"`, `"Ciudad de México"` / `"Mexico City"` → `"CMX"`)

State detection is scoped to the detected country when possible to avoid collisions (e.g. `"Ontario"` without country context is assumed `"CA-ON"` since `"Ontario, CA"` meaning California is handled by US state detection finding `"CA"` as a state abbreviation when country is already `"US"`).

**Step 5 — City.**
The leftmost remaining token after country and state are extracted is treated as the city name, trimmed and title-cased. Not validated against any list — stored as-is.

**Step 6 — Unresolvable fallback.**
If no country is detected, return `{ country: null, state: null, city: null }`. Do not guess.

### Known ambiguities handled explicitly

| Raw string | Behaviour |
|---|---|
| `"Remote"` / `"Remote - US Only"` / `"Work From Home"` | Caught by remote_type check in Step 1; all fields null |
| `"Ontario, CA"` | State lookup finds `"CA"` as California before country lookup finds Canada; parses as `US / CA / Ontario` |
| `"Ontario, Canada"` | Country lookup finds Canada; state lookup finds Ontario → `CA / ON / null` |
| `"East Coast"` | No country or state match; returns all null |
| `"LATAM"` | No match; returns all null |
| `"Multiple Locations"` | No match; returns all null |
| `"NYC"` | No country or state match; city token is `"NYC"` but country/state remain null |
| `"New York, NY"` | State match `"NY"` → US assumed; city `"New York"` → `US / NY / New York` |
| `"New York, NY, United States"` | Country found `"US"`, state `"NY"`, city `"New York"` |

### Backfill

On first boot after the migration, a startup task runs `parseLocation` against every existing `jobs` row where `location_country IS NULL AND remote_type IS NULL`. This is the same pattern as the existing fit-score backfill. Capped and logged; runs once.

---

## API changes

### `GET /api/jobs` — new query params

No new required params. All location params are optional and additive to existing filters.

```
?countries=US,CA          comma-separated ISO alpha-2 codes; overrides profile filter for this request
?states=MI,ON,QC          comma-separated state codes; requires countries to be set or profile countries to be set
?include_remote=true      override profile include_remote for this request
?include_null_location=true  override profile include_null_location for this request
?location_filter=off      bypass location filter entirely (diagnostic, mirrors ?filter=off)
```

When no location params are passed, the filter is applied from the job's profile. When params are passed, they override the profile for that request only — same pattern as the keyword filter's `?filter=off`.

### `PATCH /api/profiles/:id` — new fields

```json
{
  "allowed_countries": ["US", "CA"],
  "allowed_states": ["MI", "IL", "ON", "QC", "NS", "NB", "PE", "NL"],
  "include_remote": true,
  "include_null_location": true
}
```

Setting `allowed_countries` to `null` clears the country restriction. Setting `allowed_states` to `null` clears state restriction. `include_remote` and `include_null_location` are booleans.

### `POST /api/profiles/:id/refit`

Already exists. After a profile's location filter changes, the user can call this to rescore all jobs in the profile — fit scoring itself doesn't change, but the list view will reflect the new location filter immediately on next query.

### `GET /api/jobs/stats`

Existing stats panel gains a location breakdown row: counts by `location_country`, with a separate count for remote and a count for null-location jobs. Useful for diagnosing what the normaliser resolved and what fell through.

---

## Filter UI

The location panel lives in the jobs filter sidebar alongside the existing keyword/status/date filters.

### Layout

```
[ ] Include remote jobs

Geographic filter
  ▼ North America
      ☑ United States
          ☑ Michigan       ☑ Illinois      ☑ Maine
          ☑ Vermont        ☑ Texas         ☑ Florida
          ☑ Tennessee      ☑ N. Carolina   ☑ S. Carolina
          [ ] (all others unchecked)
      ☑ Canada
          ☑ Ontario        ☑ Quebec        ☑ Nova Scotia
          ☑ New Brunswick  ☑ P.E.I.        ☑ Newfoundland
          [ ] (all others unchecked)
      ☑ Mexico
          ☑ Mexico City    ☑ Morelos
          [ ] (all others unchecked)
  ▶ Europe
  ▶ South America
  ▶ (other continents, collapsed by default)

[ ] Include jobs with unresolvable location
```

Continent groups are UI-only accordions, not stored. Checking a country with no states selected means "all states in this country." Unchecking a country collapses and deselects its state list. The state list for a country only renders when that country is checked.

Countries that appear in the filter are driven by the distinct `location_country` values present in the user's jobs, not a hardcoded world list — so if no jobs from Europe exist yet, Europe doesn't appear. This keeps the panel from being overwhelming when most jobs are North American.

---

## Migration ownership

Per `CLAUDE.md` conventions:
- `scraper_005_location_parsed` — owned by the `scraper` module (owns the `jobs` table). Adds `location_country`, `location_state`, `location_city` columns and the composite index.
- `profiles_002_location_filter` — owned by the `profiles` module. Adds `allowed_countries`, `allowed_states`, `include_remote`, `include_null_location` columns with safe defaults (`include_remote = 1`, `include_null_location = 1`, countries/states null = no restriction). Existing profiles get permissive defaults so no jobs are newly excluded until the user configures the filter.

---

## Out of scope

- **City-level filtering** — stored for display but not exposed as a filter axis. State-level is granular enough; city filtering would require a validated city list and produces more edge cases than value for this use case.
- **Radius/proximity filtering** — requires geocoding (lat/lng) and an external lookup service. Not warranted for a personal tool.
- **Continent as a stored field** — purely a UI grouping. Country + state is the full filter surface.
- **Normalising location strings on existing jobs after a source re-assignment** — if a source is re-pointed to a different profile, fit scores are recomputed via `/refit`; location columns are not re-parsed (they were set at ingest and the raw string didn't change).
