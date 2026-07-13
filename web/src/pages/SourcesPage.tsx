import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type Source,
  type ScrapeRun,
  type ScrapeRunsResponse,
  type SourcesListResponse,
  type ProfilesListResponse,
} from '../lib/api';

/** Platforms creatable from this form. 'icims'/'custom' aren't wired to an
 *  adapter; 'manual' is a synthetic per-user source created lazily by the
 *  server, not through this endpoint. */
type CreatablePlatform = 'workday' | 'greenhouse' | 'lever' | 'ashby';

const PLATFORM_FIELD_COPY: Record<
  CreatablePlatform,
  { formTitle: string; label: string; placeholder: string; help: string }
> = {
  workday: {
    formTitle: 'Add Workday Source',
    label: 'Workday Tenant URL',
    placeholder: 'https://acme.wd1.myworkdayjobs.com/External',
    help: 'Full URL from the browser address bar on the Workday careers page.',
  },
  greenhouse: {
    formTitle: 'Add Greenhouse Source',
    label: 'Board Token',
    placeholder: 'stripe',
    help: "The company slug from their board, e.g. boards.greenhouse.io/stripe.",
  },
  lever: {
    formTitle: 'Add Lever Source',
    label: 'Company Slug',
    placeholder: 'stripe',
    help: 'The company slug from their board, e.g. jobs.lever.co/stripe.',
  },
  ashby: {
    formTitle: 'Add Ashby Source',
    label: 'Company Slug',
    placeholder: 'linear',
    help: 'The company slug from their board, e.g. jobs.ashby.io/linear.',
  },
};

export function SourcesPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [createForm, setCreateForm] = useState({
    platform: 'workday' as CreatablePlatform,
    company_name: '',
    tenant_url: '',
    profile_id: '',
    lever_eu: false,
  });
  const [createError, setCreateError] = useState<string | null>(null);

  const sourcesQ = useQuery({
    queryKey: ['sources'],
    queryFn: ({ signal }) => api.get<SourcesListResponse>('/api/sources', signal),
  });
  const profilesQ = useQuery({
    queryKey: ['profiles'],
    queryFn: ({ signal }) => api.get<ProfilesListResponse>('/api/profiles', signal),
  });

  const sources = sourcesQ.data?.sources ?? [];
  const profiles = profilesQ.data?.profiles ?? [];
  const profileMap = Object.fromEntries(profiles.map((p) => [p.id, p.name]));

  const createSource = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post<{ source: Source }>('/api/sources', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] });
      setShowCreate(false);
      setCreateForm({ platform: 'workday', company_name: '', tenant_url: '', profile_id: '', lever_eu: false });
      setCreateError(null);
    },
    onError: (err: unknown) => {
      const detail = (err as { detail?: { error?: string } }).detail;
      setCreateError(detail?.error ?? 'Failed to create source');
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.patch<{ source: Source }>(`/api/sources/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });

  const scrapeNow = useMutation({
    mutationFn: (id: number) => api.post(`/api/sources/${id}/scrape`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });

  const deleteSource = useMutation({
    mutationFn: (id: number) => api.delete(`/api/sources/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      company_name: createForm.company_name,
      platform: createForm.platform,
      tenant_url: createForm.tenant_url,
    };
    if (createForm.profile_id) payload.profile_id = Number(createForm.profile_id);
    if (createForm.platform === 'lever' && createForm.lever_eu) {
      payload.search_params = { region: 'eu' };
    }
    createSource.mutate(payload);
  }

  if (sourcesQ.isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 text-muted text-sm">Loading…</div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center mb-6">
        <h1 className="text-lg font-semibold text-ink mr-auto">Sources</h1>
        <button
          onClick={() => {
            setShowCreate(!showCreate);
            setCreateError(null);
          }}
          className="px-3 py-1.5 text-sm rounded border border-surface text-muted hover:text-ink hover:border-ink/40 transition-colors"
        >
          {showCreate ? 'Cancel' : '+ Add Source'}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mb-6 p-4 border border-surface rounded-lg bg-surface/40 space-y-3"
        >
          <h2 className="text-sm font-medium text-ink">
            {PLATFORM_FIELD_COPY[createForm.platform].formTitle}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Platform *</label>
              <select
                value={createForm.platform}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    platform: e.target.value as CreatablePlatform,
                    lever_eu: false,
                  }))
                }
                className={inputCls}
              >
                <option value="workday">Workday</option>
                <option value="greenhouse">Greenhouse</option>
                <option value="lever">Lever</option>
                <option value="ashby">Ashby</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Profile</label>
              <select
                value={createForm.profile_id}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, profile_id: e.target.value }))
                }
                className={inputCls}
              >
                <option value="">Default</option>
                {profiles.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Company Name *</label>
            <input
              required
              value={createForm.company_name}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, company_name: e.target.value }))
              }
              className={inputCls}
              placeholder="Acme Corp"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">
              {PLATFORM_FIELD_COPY[createForm.platform].label} *
            </label>
            <input
              required
              value={createForm.tenant_url}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, tenant_url: e.target.value }))
              }
              className={inputCls}
              placeholder={PLATFORM_FIELD_COPY[createForm.platform].placeholder}
            />
            <p className="text-xs text-muted mt-1">
              {PLATFORM_FIELD_COPY[createForm.platform].help}
            </p>
          </div>
          {createForm.platform === 'lever' && (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={createForm.lever_eu}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, lever_eu: e.target.checked }))
                }
              />
              EU instance (api.eu.lever.co)
            </label>
          )}
          {createError && <p className="text-xs text-red-400">{createError}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={createSource.isPending}
              className="px-4 py-1.5 text-sm rounded bg-accent text-canvas hover:bg-accent/80 disabled:opacity-50 transition-colors"
            >
              {createSource.isPending ? 'Adding…' : 'Add Source'}
            </button>
          </div>
        </form>
      )}

      {sources.length === 0 ? (
        <p className="text-sm text-muted">
          No sources yet. Add a Workday, Greenhouse, Lever, or Ashby source
          above to start scraping, or add jobs manually from the Jobs page.
        </p>
      ) : (
        <div className="space-y-2">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              profileName={source.profile_id != null ? (profileMap[source.profile_id] ?? null) : null}
              expanded={expandedId === source.id}
              onToggleHistory={() =>
                setExpandedId(expandedId === source.id ? null : source.id)
              }
              onToggle={(enabled) => toggleEnabled.mutate({ id: source.id, enabled })}
              onScrape={() => scrapeNow.mutate(source.id)}
              onDelete={() => {
                if (
                  confirm(
                    `Delete source "${source.company_name}"? This will also remove all its scraped jobs.`,
                  )
                ) {
                  deleteSource.mutate(source.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceRow({
  source,
  profileName,
  expanded,
  onToggleHistory,
  onToggle,
  onScrape,
  onDelete,
}: {
  source: Source;
  profileName: string | null;
  expanded: boolean;
  onToggleHistory: () => void;
  onToggle: (enabled: boolean) => void;
  onScrape: () => void;
  onDelete: () => void;
}) {
  const isManual = source.platform === 'manual';

  const statusColor =
    source.last_status === 'ok'
      ? 'bg-green-500'
      : source.last_status === 'error' || source.last_status === 'blocked'
      ? 'bg-red-500'
      : 'bg-surface';

  return (
    <div className="rounded-lg border border-surface bg-surface/20">
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`}
          title={source.last_status ?? 'never scraped'}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-ink">{source.company_name}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-surface text-muted">
              {source.platform}
            </span>
            {profileName && (
              <span className="text-xs text-muted">{profileName}</span>
            )}
          </div>
          {!isManual && (
            <div className="text-xs text-muted truncate mt-0.5">{source.tenant_url}</div>
          )}
          {source.last_scraped_at && (
            <div className="text-xs text-muted mt-0.5">
              Last scraped {new Date(source.last_scraped_at).toLocaleDateString()}
              {source.last_error && (
                <span className="text-red-400 ml-2" title={source.last_error}>
                  — error
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!isManual && (
            <>
              <button
                onClick={onToggleHistory}
                className="text-xs px-2 py-1 rounded border border-surface text-muted hover:text-ink hover:border-ink/40 transition-colors"
                title="Show scrape run history"
              >
                History {expanded ? '▲' : '▼'}
              </button>
              <button
                onClick={() => onToggle(!source.enabled)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  source.enabled
                    ? 'border-accent/40 text-accent hover:bg-accent/10'
                    : 'border-surface text-muted hover:text-ink'
                }`}
              >
                {source.enabled ? 'Enabled' : 'Disabled'}
              </button>
              <button
                onClick={onScrape}
                disabled={!source.enabled}
                className="text-xs px-2 py-1 rounded border border-surface text-muted hover:text-ink hover:border-ink/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Scrape now
              </button>
            </>
          )}
          <button
            onClick={onDelete}
            className="text-xs text-muted hover:text-red-400 transition-colors"
            title="Delete source"
          >
            Delete
          </button>
        </div>
      </div>

      {expanded && !isManual && (
        <SourceRunHistory sourceId={source.id} />
      )}
    </div>
  );
}

function SourceRunHistory({ sourceId }: { sourceId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['sources', sourceId, 'runs'],
    queryFn: ({ signal }) =>
      api.get<ScrapeRunsResponse>(`/api/sources/${sourceId}/runs`, signal),
  });
  const runs: ScrapeRun[] = data?.runs ?? [];

  if (isLoading) {
    return (
      <div className="border-t border-surface px-4 py-2 text-xs text-muted">
        Loading history…
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="border-t border-surface px-4 py-2 text-xs text-muted">
        No scrape runs recorded yet.
      </div>
    );
  }

  return (
    <div className="border-t border-surface px-4 py-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left border-b border-surface/50">
            <th className="pb-1 text-muted font-medium">Started</th>
            <th className="pb-1 text-muted font-medium">Status</th>
            <th className="pb-1 text-muted font-medium text-right">Found</th>
            <th className="pb-1 text-muted font-medium text-right">New</th>
            <th className="pb-1 text-muted font-medium">Error</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b border-surface/30 last:border-0">
              <td className="py-1 text-muted">
                {new Date(run.started_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </td>
              <td className="py-1">
                <span
                  className={
                    run.status === 'ok'
                      ? 'text-green-400'
                      : run.status === 'running'
                      ? 'text-blue-300'
                      : 'text-red-400'
                  }
                >
                  {run.status}
                </span>
              </td>
              <td className="py-1 text-right text-muted">{run.jobs_found}</td>
              <td className="py-1 text-right text-muted">{run.jobs_new}</td>
              <td className="py-1 text-red-400 max-w-[200px] truncate">
                {run.error_message ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const inputCls =
  'w-full text-sm px-2 py-1.5 rounded bg-surface border border-surface text-ink';
