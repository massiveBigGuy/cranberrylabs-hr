/**
 * Parses a free-text ATS location string into structured country/state/city
 * fields, per docs/location-filtering-patch3.md. Pure function, no DB
 * access — mirrors jobs/fit-scorer.ts's shape.
 *
 * Two corrections vs. the design doc, confirmed with the user before
 * implementing (see the plan's Context section):
 *   - The remote short-circuit checks `remoteType === 'remote'` specifically,
 *     not "any non-null remote_type" — onsite/hybrid postings have real
 *     addresses and should still get parsed.
 *   - When no country is detected, ALL fields stay null (including city),
 *     per the doc's own Step 6 ("do not guess"), which takes precedence
 *     over an imprecise parenthetical elsewhere in the doc.
 */
import {
  FULL_NAME_COUNTRIES,
  BARE_CODE_COUNTRIES,
  STATE_LOOKUP_BY_COUNTRY,
  normalize,
} from './location-data';

export interface ParsedLocation {
  country: string | null;
  state: string | null;
  city: string | null;
}

const NULL_LOCATION: ParsedLocation = { country: null, state: null, city: null };

export function parseLocation(raw: string | null, remoteType: string | null): ParsedLocation {
  if (remoteType === 'remote') return NULL_LOCATION;
  if (!raw || !raw.trim()) return NULL_LOCATION;

  let tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return NULL_LOCATION;

  let country: string | null = null;

  // Pass A — full country names. Scanned right to left, per the doc's Step
  // 3 — "City, State, Country" ordering means a country token, when
  // present, is near the end. This also matters for tokens like
  // "New York, NY" where a right-to-left scan finds the abbreviation "NY"
  // as the state before a left-to-right scan would wrongly consume the
  // full state name "New York" and leave "NY" to be mis-titled as the city.
  for (let i = tokens.length - 1; i >= 0; i--) {
    const code = FULL_NAME_COUNTRIES[normalize(tokens[i]!)];
    if (code) {
      country = code;
      tokens = tokens.filter((_, idx) => idx !== i);
      break;
    }
  }

  // Pass B — bare ISO alpha-2 codes (only the non-collision-prone ones).
  if (!country) {
    for (let i = tokens.length - 1; i >= 0; i--) {
      const code = BARE_CODE_COUNTRIES[normalize(tokens[i]!)];
      if (code) {
        country = code;
        tokens = tokens.filter((_, idx) => idx !== i);
        break;
      }
    }
  }

  // State pass — scoped to the detected country's state table (US/CA/MX
  // only). If no country was detected yet, try all three: a match both
  // sets the state and infers the country from whichever table matched.
  // Right-to-left for the same reason as the country passes above.
  let state: string | null = null;
  const candidateCountries = country ? [country] : ['US', 'CA', 'MX'];
  for (const candidate of candidateCountries) {
    const table = STATE_LOOKUP_BY_COUNTRY[candidate];
    if (!table) continue;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const code = table[normalize(tokens[i]!)];
      if (code) {
        state = code;
        country = candidate;
        tokens = tokens.filter((_, idx) => idx !== i);
        break;
      }
    }
    if (state) break;
  }

  if (!country) return NULL_LOCATION;

  const city = tokens.length > 0 ? titleCase(tokens[0]!) : null;

  return { country, state, city };
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}
