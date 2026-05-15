import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs, type JobsListResponse } from '../lib/api';
import { JobList } from '../components/JobList';
import { JobDetailDrawer } from '../components/JobDetailDrawer';

/**
 * The /jobs page. Default view is "today's filtered listings" per §8 of
 * the schema. We resolve "today" as posted within the last 24h. There's
 * no separate /jobs/all route yet (deferred to a later step), but you
 * can flip the date filter to "All" in this view to widen.
 */
export function JobsPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sinceDays, setSinceDays] = useState<number | null>(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Build the `since` ISO date from sinceDays. null = no date filter.
  const sinceIso =
    sinceDays === null
      ? undefined
      : new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);

  const query = useQuery({
    queryKey: ['jobs', { since: sinceIso, search }],
    queryFn: ({ signal }) =>
      api.get<JobsListResponse>(
        '/api/jobs' +
          qs({
            since: sinceIso,
            search,
            limit: 100,
          }),
        signal,
      ),
  });

  // Submit search on Enter or blur (rather than per-keystroke) to avoid
  // hammering the API. Cheap in our case but it's also better UX.
  function commitSearch() {
    setSearch(searchInput.trim());
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-lg font-semibold text-ink mr-auto">Jobs</h1>

        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onBlur={commitSearch}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitSearch();
          }}
          placeholder="Search title / company"
          className="text-sm px-3 py-1.5 rounded bg-surface border border-surface text-ink w-64"
        />

        <div className="flex items-center gap-1 text-xs">
          <DateFilterButton
            label="24h"
            active={sinceDays === 1}
            onClick={() => setSinceDays(1)}
          />
          <DateFilterButton
            label="7d"
            active={sinceDays === 7}
            onClick={() => setSinceDays(7)}
          />
          <DateFilterButton
            label="30d"
            active={sinceDays === 30}
            onClick={() => setSinceDays(30)}
          />
          <DateFilterButton
            label="All"
            active={sinceDays === null}
            onClick={() => setSinceDays(null)}
          />
        </div>
      </div>

      {/* Result count */}
      {query.data && (
        <div className="text-xs text-muted mb-3">
          {query.data.total} {query.data.total === 1 ? 'job' : 'jobs'} matching
          {sinceDays !== null && ` · last ${sinceDays}d`}
          {search && ` · "${search}"`}
        </div>
      )}

      <JobList
        jobs={query.data?.jobs ?? []}
        onOpen={(id) => setSelectedId(id)}
        isLoading={query.isLoading}
        isError={query.isError}
      />

      <JobDetailDrawer
        jobId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

function DateFilterButton(props: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={props.onClick}
      className={`px-2 py-1 rounded transition-colors ${
        props.active
          ? 'bg-surface text-ink'
          : 'text-muted hover:text-ink hover:bg-surface/50'
      }`}
    >
      {props.label}
    </button>
  );
}
