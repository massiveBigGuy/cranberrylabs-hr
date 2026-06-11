import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, qs, type JobsListResponse, type ProfilesListResponse } from '../lib/api';
import { JobList } from '../components/JobList';
import { JobDetailDrawer } from '../components/JobDetailDrawer';
import { JobStatsPanel } from '../components/JobStatsPanel';
import { AddJobModal } from '../components/AddJobModal';

export function JobsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sinceDays, setSinceDays] = useState<number | null>(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'fit' | 'date'>('fit');
  const [profileId, setProfileId] = useState<number | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());
  const [bulkAdapter, setBulkAdapter] = useState<'anthropic' | 'ollama'>('anthropic');
  const [showAddJob, setShowAddJob] = useState(false);

  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: ({ signal }) => api.get<ProfilesListResponse>('/api/profiles', signal),
  });
  const profiles = profilesQuery.data?.profiles ?? [];

  const sinceIso =
    sinceDays === null
      ? undefined
      : new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);

  const query = useQuery({
    queryKey: ['jobs', { since: sinceIso, search, sortBy, profileId }],
    queryFn: ({ signal }) =>
      api.get<JobsListResponse>(
        '/api/jobs' +
          qs({
            since: sinceIso,
            search,
            sort: sortBy,
            profile_id: profileId ?? undefined,
            limit: 100,
          }),
        signal,
      ),
  });

  const jobs = query.data?.jobs ?? [];

  function commitSearch() {
    setSearch(searchInput.trim());
  }

  function toggleJob(id: number) {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedJobIds.size === jobs.length && jobs.length > 0) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(jobs.map((j) => j.id)));
    }
  }

  // Fire one POST per selected job; ignore 409s (application already exists).
  // Promise.allSettled so a single failure doesn't block the others.
  const bulkGenerate = useMutation({
    mutationFn: async ({ ids, adapter }: { ids: number[]; adapter: 'anthropic' | 'ollama' }) => {
      await Promise.allSettled(
        ids.map((id) => api.post('/api/applications', { job_id: id, adapter })),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      setSelectedJobIds(new Set());
      navigate('/applications');
    },
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-lg font-semibold text-ink mr-auto">Jobs</h1>

        <button
          onClick={() => setShowAddJob(true)}
          className="text-xs px-2.5 py-1.5 rounded border border-surface text-muted hover:text-ink hover:border-ink/40 transition-colors"
        >
          + Add Job
        </button>

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

        {profiles.length > 1 && (
          <select
            value={profileId ?? ''}
            onChange={(e) => setProfileId(e.target.value === '' ? null : Number(e.target.value))}
            className="text-sm px-2 py-1.5 rounded bg-surface border border-surface text-ink"
          >
            <option value="">All profiles</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-1 text-xs">
          <DateFilterButton label="24h" active={sinceDays === 1} onClick={() => setSinceDays(1)} />
          <DateFilterButton label="7d"  active={sinceDays === 7} onClick={() => setSinceDays(7)} />
          <DateFilterButton label="30d" active={sinceDays === 30} onClick={() => setSinceDays(30)} />
          <DateFilterButton label="All" active={sinceDays === null} onClick={() => setSinceDays(null)} />
        </div>

        <div className="flex items-center gap-1 text-xs border-l border-surface pl-3">
          <span className="text-muted mr-1">Sort:</span>
          <DateFilterButton label="Fit"  active={sortBy === 'fit'}  onClick={() => setSortBy('fit')} />
          <DateFilterButton label="Date" active={sortBy === 'date'} onClick={() => setSortBy('date')} />
        </div>
      </div>

      {/* Batch action bar — visible only when jobs are selected */}
      {selectedJobIds.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 rounded bg-surface/60 border border-surface text-sm">
          <span className="text-muted">
            {selectedJobIds.size} {selectedJobIds.size === 1 ? 'job' : 'jobs'} selected
          </span>
          <select
            value={bulkAdapter}
            onChange={(e) => setBulkAdapter(e.target.value as 'anthropic' | 'ollama')}
            disabled={bulkGenerate.isPending}
            className="text-xs px-2 py-1 rounded bg-surface border border-surface text-muted disabled:opacity-50"
          >
            <option value="anthropic">Claude</option>
            <option value="ollama">Ollama</option>
          </select>
          <button
            onClick={() => bulkGenerate.mutate({ ids: [...selectedJobIds], adapter: bulkAdapter })}
            disabled={bulkGenerate.isPending}
            className="px-3 py-1 rounded border border-accent bg-accent/10 text-accent hover:bg-accent/20 transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bulkGenerate.isPending
              ? 'Queuing…'
              : `Generate ${selectedJobIds.size} Application${selectedJobIds.size === 1 ? '' : 's'}`}
          </button>
          <button
            onClick={() => setSelectedJobIds(new Set())}
            className="text-xs text-muted hover:text-ink transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      <JobStatsPanel />

      {query.data && (
        <div className="text-xs text-muted mb-3">
          {query.data.total} of {query.data.total_unfiltered}{' '}
          {query.data.total_unfiltered === 1 ? 'job' : 'jobs'}
          {sinceDays !== null && ` · last ${sinceDays}d`}
          {search && ` · "${search}"`}
          {profileId !== null && ` · ${profiles.find((p) => p.id === profileId)?.name ?? 'profile'}`}
        </div>
      )}

      <JobList
        jobs={jobs}
        onOpen={(id) => setSelectedId(id)}
        isLoading={query.isLoading}
        isError={query.isError}
        selectedIds={selectedJobIds}
        onToggle={toggleJob}
        onToggleAll={toggleAll}
      />

      <JobDetailDrawer
        jobId={selectedId}
        onClose={() => setSelectedId(null)}
      />

      {showAddJob && (
        <AddJobModal profiles={profiles} onClose={() => setShowAddJob(false)} />
      )}
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
