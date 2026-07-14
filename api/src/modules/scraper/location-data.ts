/**
 * Static lookup tables for location-parser.ts. Country/state/province
 * codes follow docs/location-filtering-patch3.md's convention: ISO 3166-1
 * alpha-2 for country, ISO 3166-2 subdivision code with the country
 * prefix stripped for state/province (e.g. "MI" not "US-MI", "MOR" not
 * "MX-MOR").
 */

interface CodeEntry {
  code: string;
  names: string[]; // full names / aliases; the code itself is added as a lookup key separately
}

function buildLookup(entries: CodeEntry[], includeCode = true): Record<string, string> {
  const lookup: Record<string, string> = {};
  for (const entry of entries) {
    if (includeCode) lookup[normalize(entry.code)] = entry.code;
    for (const name of entry.names) lookup[normalize(name)] = entry.code;
  }
  return lookup;
}

export function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\./g, '');
}

// ---------------------------------------------------------------------------
// US states (+ DC)
// ---------------------------------------------------------------------------

const US_STATE_ENTRIES: CodeEntry[] = [
  { code: 'AL', names: ['Alabama'] },
  { code: 'AK', names: ['Alaska'] },
  { code: 'AZ', names: ['Arizona'] },
  { code: 'AR', names: ['Arkansas'] },
  { code: 'CA', names: ['California'] },
  { code: 'CO', names: ['Colorado'] },
  { code: 'CT', names: ['Connecticut'] },
  { code: 'DE', names: ['Delaware'] },
  { code: 'FL', names: ['Florida'] },
  { code: 'GA', names: ['Georgia'] },
  { code: 'HI', names: ['Hawaii'] },
  { code: 'ID', names: ['Idaho'] },
  { code: 'IL', names: ['Illinois'] },
  { code: 'IN', names: ['Indiana'] },
  { code: 'IA', names: ['Iowa'] },
  { code: 'KS', names: ['Kansas'] },
  { code: 'KY', names: ['Kentucky'] },
  { code: 'LA', names: ['Louisiana'] },
  { code: 'ME', names: ['Maine'] },
  { code: 'MD', names: ['Maryland'] },
  { code: 'MA', names: ['Massachusetts'] },
  { code: 'MI', names: ['Michigan'] },
  { code: 'MN', names: ['Minnesota'] },
  { code: 'MS', names: ['Mississippi'] },
  { code: 'MO', names: ['Missouri'] },
  { code: 'MT', names: ['Montana'] },
  { code: 'NE', names: ['Nebraska'] },
  { code: 'NV', names: ['Nevada'] },
  { code: 'NH', names: ['New Hampshire'] },
  { code: 'NJ', names: ['New Jersey'] },
  { code: 'NM', names: ['New Mexico'] },
  { code: 'NY', names: ['New York'] },
  { code: 'NC', names: ['North Carolina'] },
  { code: 'ND', names: ['North Dakota'] },
  { code: 'OH', names: ['Ohio'] },
  { code: 'OK', names: ['Oklahoma'] },
  { code: 'OR', names: ['Oregon'] },
  { code: 'PA', names: ['Pennsylvania'] },
  { code: 'RI', names: ['Rhode Island'] },
  { code: 'SC', names: ['South Carolina'] },
  { code: 'SD', names: ['South Dakota'] },
  { code: 'TN', names: ['Tennessee'] },
  { code: 'TX', names: ['Texas'] },
  { code: 'UT', names: ['Utah'] },
  { code: 'VT', names: ['Vermont'] },
  { code: 'VA', names: ['Virginia'] },
  { code: 'WA', names: ['Washington'] },
  { code: 'WV', names: ['West Virginia'] },
  { code: 'WI', names: ['Wisconsin'] },
  { code: 'WY', names: ['Wyoming'] },
  { code: 'DC', names: ['District of Columbia', 'Washington DC', 'Washington D.C.'] },
];

export const US_STATES: Record<string, string> = buildLookup(US_STATE_ENTRIES);

// ---------------------------------------------------------------------------
// Canadian provinces & territories
// ---------------------------------------------------------------------------

const CA_PROVINCE_ENTRIES: CodeEntry[] = [
  { code: 'ON', names: ['Ontario'] },
  { code: 'QC', names: ['Quebec', 'Québec'] },
  { code: 'NS', names: ['Nova Scotia'] },
  { code: 'NB', names: ['New Brunswick'] },
  { code: 'MB', names: ['Manitoba'] },
  { code: 'BC', names: ['British Columbia'] },
  { code: 'PE', names: ['Prince Edward Island', 'PEI', 'P.E.I.'] },
  { code: 'SK', names: ['Saskatchewan'] },
  { code: 'AB', names: ['Alberta'] },
  { code: 'NL', names: ['Newfoundland and Labrador', 'Newfoundland'] },
  { code: 'NT', names: ['Northwest Territories'] },
  { code: 'YT', names: ['Yukon'] },
  { code: 'NU', names: ['Nunavut'] },
];

export const CA_PROVINCES: Record<string, string> = buildLookup(CA_PROVINCE_ENTRIES);

// ---------------------------------------------------------------------------
// Mexican states (ISO 3166-2:MX subdivision codes, prefix stripped)
// ---------------------------------------------------------------------------

const MX_STATE_ENTRIES: CodeEntry[] = [
  { code: 'AGU', names: ['Aguascalientes'] },
  { code: 'BCN', names: ['Baja California'] },
  { code: 'BCS', names: ['Baja California Sur'] },
  { code: 'CAM', names: ['Campeche'] },
  { code: 'CHP', names: ['Chiapas'] },
  { code: 'CHH', names: ['Chihuahua'] },
  { code: 'CMX', names: ['Ciudad de México', 'Mexico City', 'Distrito Federal', 'CDMX'] },
  { code: 'COA', names: ['Coahuila'] },
  { code: 'COL', names: ['Colima'] },
  { code: 'DUR', names: ['Durango'] },
  { code: 'GUA', names: ['Guanajuato'] },
  { code: 'GRO', names: ['Guerrero'] },
  { code: 'HID', names: ['Hidalgo'] },
  { code: 'JAL', names: ['Jalisco'] },
  { code: 'MEX', names: ['Estado de México', 'Mexico State'] },
  { code: 'MIC', names: ['Michoacán'] },
  { code: 'MOR', names: ['Morelos'] },
  { code: 'NAY', names: ['Nayarit'] },
  { code: 'NLE', names: ['Nuevo León'] },
  { code: 'OAX', names: ['Oaxaca'] },
  { code: 'PUE', names: ['Puebla'] },
  { code: 'QUE', names: ['Querétaro'] },
  { code: 'ROO', names: ['Quintana Roo'] },
  { code: 'SLP', names: ['San Luis Potosí'] },
  { code: 'SIN', names: ['Sinaloa'] },
  { code: 'SON', names: ['Sonora'] },
  { code: 'TAB', names: ['Tabasco'] },
  { code: 'TAM', names: ['Tamaulipas'] },
  { code: 'TLA', names: ['Tlaxcala'] },
  { code: 'VER', names: ['Veracruz'] },
  { code: 'YUC', names: ['Yucatán'] },
  { code: 'ZAC', names: ['Zacatecas'] },
];

export const MX_STATES: Record<string, string> = buildLookup(MX_STATE_ENTRIES);

export const STATE_LOOKUP_BY_COUNTRY: Record<string, Record<string, string>> = {
  US: US_STATES,
  CA: CA_PROVINCES,
  MX: MX_STATES,
};

// ---------------------------------------------------------------------------
// Countries — full names (all) + bare ISO alpha-2 codes (only where the
// code doesn't collide with a US state or Canadian province abbreviation;
// the exclusion is computed below, not hand-picked per entry).
// ---------------------------------------------------------------------------

const COUNTRY_ENTRIES: CodeEntry[] = [
  { code: 'US', names: ['United States', 'United States of America', 'USA', 'U.S.', 'U.S.A.'] },
  { code: 'CA', names: ['Canada'] },
  { code: 'MX', names: ['Mexico', 'México', 'United Mexican States'] },
  { code: 'GB', names: ['United Kingdom', 'UK', 'U.K.', 'Great Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'] },
  { code: 'IE', names: ['Ireland'] },
  { code: 'FR', names: ['France'] },
  { code: 'DE', names: ['Germany', 'Deutschland'] },
  { code: 'ES', names: ['Spain', 'España'] },
  { code: 'IT', names: ['Italy', 'Italia'] },
  { code: 'NL', names: ['Netherlands', 'The Netherlands', 'Holland'] },
  { code: 'PT', names: ['Portugal'] },
  { code: 'BE', names: ['Belgium'] },
  { code: 'CH', names: ['Switzerland'] },
  { code: 'AT', names: ['Austria'] },
  { code: 'SE', names: ['Sweden'] },
  { code: 'NO', names: ['Norway'] },
  { code: 'DK', names: ['Denmark'] },
  { code: 'FI', names: ['Finland'] },
  { code: 'PL', names: ['Poland'] },
  { code: 'GR', names: ['Greece'] },
  { code: 'CZ', names: ['Czechia', 'Czech Republic'] },
  { code: 'RO', names: ['Romania'] },
  { code: 'HU', names: ['Hungary'] },
  { code: 'UA', names: ['Ukraine'] },
  { code: 'IS', names: ['Iceland'] },
  { code: 'LU', names: ['Luxembourg'] },
  { code: 'HR', names: ['Croatia'] },
  { code: 'RS', names: ['Serbia'] },
  { code: 'BG', names: ['Bulgaria'] },
  { code: 'SK', names: ['Slovakia'] },
  { code: 'SI', names: ['Slovenia'] },
  { code: 'LT', names: ['Lithuania'] },
  { code: 'LV', names: ['Latvia'] },
  { code: 'EE', names: ['Estonia'] },
  { code: 'MT', names: ['Malta'] },
  { code: 'CY', names: ['Cyprus'] },
  { code: 'IN', names: ['India'] },
  { code: 'CN', names: ['China'] },
  { code: 'JP', names: ['Japan'] },
  { code: 'KR', names: ['South Korea', 'Korea'] },
  { code: 'SG', names: ['Singapore'] },
  { code: 'PH', names: ['Philippines'] },
  { code: 'VN', names: ['Vietnam'] },
  { code: 'TH', names: ['Thailand'] },
  { code: 'ID', names: ['Indonesia'] },
  { code: 'MY', names: ['Malaysia'] },
  { code: 'TW', names: ['Taiwan'] },
  { code: 'HK', names: ['Hong Kong'] },
  { code: 'AU', names: ['Australia'] },
  { code: 'NZ', names: ['New Zealand'] },
  { code: 'BR', names: ['Brazil', 'Brasil'] },
  { code: 'AR', names: ['Argentina'] },
  { code: 'CL', names: ['Chile'] },
  { code: 'CO', names: ['Colombia'] },
  { code: 'PE', names: ['Peru', 'Perú'] },
  { code: 'UY', names: ['Uruguay'] },
  { code: 'EC', names: ['Ecuador'] },
  { code: 'VE', names: ['Venezuela'] },
  { code: 'CR', names: ['Costa Rica'] },
  { code: 'PA', names: ['Panama', 'Panamá'] },
  { code: 'DO', names: ['Dominican Republic'] },
  { code: 'JM', names: ['Jamaica'] },
  { code: 'TT', names: ['Trinidad and Tobago'] },
  { code: 'EG', names: ['Egypt'] },
  { code: 'ZA', names: ['South Africa'] },
  { code: 'NG', names: ['Nigeria'] },
  { code: 'KE', names: ['Kenya'] },
  { code: 'GH', names: ['Ghana'] },
  { code: 'ET', names: ['Ethiopia'] },
  { code: 'TZ', names: ['Tanzania'] },
  { code: 'UG', names: ['Uganda'] },
  { code: 'MA', names: ['Morocco'] },
  { code: 'IL', names: ['Israel'] },
  { code: 'AE', names: ['United Arab Emirates', 'UAE'] },
  { code: 'SA', names: ['Saudi Arabia'] },
  { code: 'QA', names: ['Qatar'] },
  { code: 'KW', names: ['Kuwait'] },
  { code: 'JO', names: ['Jordan'] },
  { code: 'LB', names: ['Lebanon'] },
  { code: 'TR', names: ['Turkey', 'Türkiye'] },
  { code: 'PK', names: ['Pakistan'] },
  { code: 'BD', names: ['Bangladesh'] },
];

export const FULL_NAME_COUNTRIES: Record<string, string> = buildLookup(COUNTRY_ENTRIES, false);

// Bare ISO alpha-2 codes are only safe to match standalone (e.g. a lone
// "CA" token) when they don't collide with a US state or Canadian province
// abbreviation — otherwise "CA" would resolve to Canada instead of
// California, which docs/location-filtering-patch3.md's worked example
// ("Ontario, CA" -> US/CA/Ontario) explicitly says is wrong. Computed here
// rather than hand-picked per entry so the exclusion set can't drift out of
// sync with the state tables above.
const STATE_CODE_COLLISIONS = new Set([
  ...Object.values(US_STATES),
  ...Object.values(CA_PROVINCES),
]);

export const BARE_CODE_COUNTRIES: Record<string, string> = Object.fromEntries(
  COUNTRY_ENTRIES.filter((c) => !STATE_CODE_COLLISIONS.has(c.code)).map((c) => [
    normalize(c.code),
    c.code,
  ]),
);
