import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Profile } from '../lib/api';
import { CONTINENTS, STATE_OPTIONS } from '../lib/locations';

interface LocationStats {
  by_location_country: Record<string, number>;
  location_remote_count: number;
  location_null_count: number;
}

/**
 * Geographic filter panel for the Jobs page, per
 * docs/location-filtering-patch3.md's "Filter UI" mock. Checking a box
 * PATCHes the currently-selected profile immediately (location filters are
 * a profile-level preference, not a session-only override — see the
 * feature's plan doc for why this differs from how keyword filters, which
 * have no interactive UI here at all, are edited).
 *
 * Continents are a pure UI grouping (web/src/lib/locations.ts) — never
 * sent to the API. Only countries with at least one parsed job render, per
 * the design doc, so the panel doesn't overwhelm with irrelevant regions.
 */
export function LocationFilterPanel({ profile }: { profile: Profile | null }) {
  const qc = useQueryClient();
  const [openContinents, setOpenContinents] = useState<Set<string>>(new Set());

  const statsQ = useQuery({
    queryKey: ['jobs', 'stats'],
    queryFn: ({ signal }) => api.get<LocationStats>('/api/jobs/stats', signal),
  });
  const countryCounts = statsQ.data?.by_location_country ?? {};
  const remoteCount = statsQ.data?.location_remote_count ?? 0;
  const nullCount = statsQ.data?.location_null_count ?? 0;

  const patchMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.patch<{ profile: Profile }>(`/api/profiles/${profile!.id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });

  const allowedCountries = useMemo(
    () => (profile?.allowed_countries ? (JSON.parse(profile.allowed_countries) as string[]) : null),
    [profile?.allowed_countries],
  );
  const allowedStates = useMemo(
    () => (profile?.allowed_states ? (JSON.parse(profile.allowed_states) as string[]) : null),
    [profile?.allowed_states],
  );

  function isCountryAllowed(code: string): boolean {
    return allowedCountries === null || allowedCountries.includes(code);
  }
  function isStateAllowed(code: string): boolean {
    return allowedStates === null || allowedStates.includes(code);
  }

  // Base set used the first time a null (unrestricted) filter gets its
  // first uncheck — null silently allows everything including countries
  // with no jobs yet, so it has to expand to an explicit list of exactly
  // what's currently allowed before subtracting one, rather than being
  // toggled directly.
  function baseAllowedStates(): string[] {
    const result: string[] = [];
    for (const code of ['US', 'CA', 'MX'] as const) {
      if (isCountryAllowed(code)) result.push(...STATE_OPTIONS[code].map((s) => s.code));
    }
    return result;
  }

  function toggleCountry(code: string, checked: boolean) {
    const knownCountries = Object.keys(countryCounts);
    const base = allowedCountries ?? knownCountries;
    const nextCountries = checked
      ? Array.from(new Set([...base, code]))
      : base.filter((c) => c !== code);

    const patch: Record<string, unknown> = { allowed_countries: nextCountries };
    // Unchecking a country also drops its states from allowed_states so a
    // stale state-level allow doesn't silently keep matching jobs in a
    // country the user just excluded.
    if (!checked && isNaStateCountry(code)) {
      const baseStates = allowedStates ?? baseAllowedStates();
      const stripCodes = new Set(STATE_OPTIONS[code].map((s) => s.code));
      patch.allowed_states = baseStates.filter((s) => !stripCodes.has(s));
    }
    patchMutation.mutate(patch);
  }

  function toggleState(stateCode: string, checked: boolean) {
    const base = allowedStates ?? baseAllowedStates();
    const next = checked ? Array.from(new Set([...base, stateCode])) : base.filter((s) => s !== stateCode);
    patchMutation.mutate({ allowed_states: next });
  }

  function toggleContinent(name: string) {
    setOpenContinents((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (!profile) {
    return (
      <div className="mb-4 border border-surface rounded px-4 py-3 text-sm text-muted">
        Select a profile above to edit its location filter.
      </div>
    );
  }

  const visibleContinents = CONTINENTS.map((continent) => ({
    ...continent,
    countries: continent.countries.filter((c) => (countryCounts[c.code] ?? 0) > 0),
  })).filter((continent) => continent.countries.length > 0);

  return (
    <div className="mb-4 border border-surface rounded">
      <div className="px-4 py-3 border-b border-surface">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={profile.include_remote === 1}
            onChange={(e) => patchMutation.mutate({ include_remote: e.target.checked })}
          />
          Include remote jobs
          {remoteCount > 0 && <span className="text-muted">({remoteCount})</span>}
        </label>
      </div>

      <div className="px-4 py-3">
        <h3 className="text-xs uppercase tracking-wide text-muted mb-2">Geographic filter</h3>
        {visibleContinents.length === 0 && (
          <p className="text-xs text-muted">No parsed locations yet.</p>
        )}
        {visibleContinents.map((continent) => (
          <div key={continent.name} className="mb-1">
            <button
              onClick={() => toggleContinent(continent.name)}
              className="flex items-center gap-1.5 text-sm text-ink hover:text-accent transition-colors py-1"
            >
              <span className="text-xs w-3 inline-block">
                {openContinents.has(continent.name) ? '▾' : '▸'}
              </span>
              {continent.name}
            </button>
            {openContinents.has(continent.name) && (
              <div className="pl-5 space-y-1.5">
                {continent.countries.map((country) => (
                  <div key={country.code}>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={isCountryAllowed(country.code)}
                        onChange={(e) => toggleCountry(country.code, e.target.checked)}
                      />
                      {country.name}
                      <span className="text-xs text-muted">({countryCounts[country.code] ?? 0})</span>
                    </label>
                    {isCountryAllowed(country.code) && isNaStateCountry(country.code) && (
                      <div className="pl-6 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 mt-1">
                        {STATE_OPTIONS[country.code].map((state) => (
                          <label
                            key={state.code}
                            className="flex items-center gap-1.5 text-xs text-muted"
                          >
                            <input
                              type="checkbox"
                              checked={isStateAllowed(state.code)}
                              onChange={(e) => toggleState(state.code, e.target.checked)}
                            />
                            {state.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="px-4 py-3 border-t border-surface">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={profile.include_null_location === 1}
            onChange={(e) => patchMutation.mutate({ include_null_location: e.target.checked })}
          />
          Include jobs with unresolvable location
          {nullCount > 0 && <span className="text-muted">({nullCount})</span>}
        </label>
      </div>
    </div>
  );
}

function isNaStateCountry(code: string): code is 'US' | 'CA' | 'MX' {
  return code === 'US' || code === 'CA' || code === 'MX';
}
