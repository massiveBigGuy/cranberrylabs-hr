import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type Source,
  type SourcesListResponse,
  type Profile,
  type ProfilesListResponse,
} from '../lib/api';

export function SourcesPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    company_name: '',
    tenant_url: '',
    profile_id: '',
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
      setCreateForm({ company_name: '', tenant_url: '', profile_id: '' });
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
      platform: 'workday',
      tenant_url: createForm.tenant_url,
    };
    if (createForm.profile_id) payload.profile_id = Number(createForm.profile_id);
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
          <h2 className="text-sm font-medium text-ink">Add Workday Source</h2>
          <div className="grid grid-cols-2 gap-3">
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
            <label className="block text-xs text-muted mb-1">Workday Tenant URL *</label>
            <input
              required
              value={createForm.tenant_url}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, tenant_url: e.target.value }))
              }
              className={inputCls}
              placeholder="https://acme.wd1.myworkdayjobs.com/External"
            />
            <p className="text-xs text-muted mt-1">
              Full URL from the browser address bar on the Workday careers page.
            </p>
          </div>
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
          No sources yet. Add a Workday source above to start scraping, or add jobs
          manually from the Jobs page.
        </p>
      ) : (
        <div className="space-y-2">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              profileName={source.profile_id != null ? (profileMap[source.profile_id] ?? null) : null}
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
  onToggle,
  onScrape,
  onDelete,
}: {
  source: Source;
  profileName: string | null;
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
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-surface bg-surface/20">
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
  );
}

const inputCls =
  'w-full text-sm px-2 py-1.5 rounded bg-surface border border-surface text-ink';
