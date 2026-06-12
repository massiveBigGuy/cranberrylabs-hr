import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, qs, type JobsListResponse, type ProfilesListResponse, type SystemPromptResponse } from '../lib/api';
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
  const [showGenerateModal, setShowGenerateModal] = useState(false);

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
    mutationFn: async ({
      ids,
      adapter,
      systemPrompt,
    }: {
      ids: number[];
      adapter: 'anthropic' | 'ollama';
      systemPrompt?: string;
    }) => {
      await Promise.allSettled(
        ids.map((id) =>
          api.post('/api/applications', {
            job_id: id,
            adapter,
            ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
          }),
        ),
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
            onClick={() => setShowGenerateModal(true)}
            disabled={bulkGenerate.isPending}
            className="px-3 py-1 rounded border border-accent bg-accent/10 text-accent hover:bg-accent/20 transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bulkGenerate.isPending
              ? 'Queuing…'
              : `Generate ${selectedJobIds.size} Application${selectedJobIds.size === 1 ? '' : 's'}`}
          </button>

          {showGenerateModal && (
            <GenerateModal
              jobCount={selectedJobIds.size}
              adapter={bulkAdapter}
              onConfirm={(prompt) => {
                setShowGenerateModal(false);
                bulkGenerate.mutate({ ids: [...selectedJobIds], adapter: bulkAdapter, systemPrompt: prompt });
              }}
              onCancel={() => setShowGenerateModal(false)}
            />
          )}
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

function GenerateModal({
  jobCount,
  adapter,
  onConfirm,
  onCancel,
}: {
  jobCount: number;
  adapter: 'anthropic' | 'ollama';
  onConfirm: (systemPrompt?: string) => void;
  onCancel: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null); // null = not loaded yet
  const [edited, setEdited] = useState(false);

  function handleExpand() {
    setExpanded(true);
    if (prompt === null) {
      api.get<SystemPromptResponse>('/api/applications/prompt').then((r) => {
        setPrompt(r.prompt);
      });
    }
  }

  function handleConfirm() {
    onConfirm(edited && prompt != null ? prompt : undefined);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-canvas border border-surface rounded-lg shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        <div className="px-5 py-4 border-b border-surface">
          <h2 className="text-sm font-semibold text-ink">
            Generate {jobCount} Application{jobCount === 1 ? '' : 's'}
          </h2>
          <p className="text-xs text-muted mt-0.5">
            {adapter === 'anthropic' ? 'Claude (Anthropic)' : 'Ollama (local)'}
          </p>
        </div>

        <div className="px-5 py-3 border-b border-surface overflow-y-auto">
          <button
            onClick={expanded ? () => setExpanded(false) : handleExpand}
            className="text-xs text-muted hover:text-ink transition-colors flex items-center gap-1"
          >
            Advanced {expanded ? '▲' : '▼'} Edit system prompt
          </button>

          {expanded && (
            <div className="mt-3">
              {prompt === null ? (
                <p className="text-xs text-muted">Loading…</p>
              ) : (
                <>
                  <textarea
                    value={prompt}
                    onChange={(e) => { setPrompt(e.target.value); setEdited(true); }}
                    rows={12}
                    className="w-full text-xs px-2 py-1.5 rounded bg-surface border border-surface text-ink font-mono resize-y"
                  />
                  {edited && (
                    <button
                      onClick={() => { setEdited(false); setPrompt(null); handleExpand(); }}
                      className="mt-1 text-xs text-muted hover:text-ink transition-colors"
                    >
                      Reset to default
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded border border-surface text-muted hover:text-ink transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="text-xs px-3 py-1.5 rounded bg-accent text-canvas hover:bg-accent/80 transition-colors"
          >
            Generate
          </button>
        </div>
      </div>
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
