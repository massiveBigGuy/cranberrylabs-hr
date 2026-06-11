import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Profile, type ProfilesListResponse } from '../lib/api';

function parseKws(json: string | null): string {
  if (!json) return '';
  try {
    return (JSON.parse(json) as string[]).join(', ');
  } catch {
    return '';
  }
}

function kwsToArray(str: string): string[] {
  return str
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ProfilesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    target: '',
    excluded: '',
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [editForms, setEditForms] = useState<
    Record<number, { name: string; target: string; excluded: string }>
  >({});
  const [editError, setEditError] = useState<string | null>(null);

  const profilesQ = useQuery({
    queryKey: ['profiles'],
    queryFn: ({ signal }) => api.get<ProfilesListResponse>('/api/profiles', signal),
  });
  const profiles = profilesQ.data?.profiles ?? [];

  const createProfile = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post<{ profile: Profile }>('/api/profiles', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      setShowCreate(false);
      setCreateForm({ name: '', target: '', excluded: '' });
      setCreateError(null);
    },
    onError: (err: unknown) => {
      const detail = (err as { detail?: { error?: string } }).detail;
      setCreateError(detail?.error ?? 'Failed to create profile');
    },
  });

  const updateProfile = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      api.patch<{ profile: Profile }>(`/api/profiles/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      setEditing(null);
      setEditError(null);
    },
    onError: (err: unknown) => {
      const detail = (err as { detail?: { error?: string } }).detail;
      setEditError(detail?.error ?? 'Failed to update profile');
    },
  });

  const setDefault = useMutation({
    mutationFn: (id: number) =>
      api.patch<{ profile: Profile }>(`/api/profiles/${id}`, { is_default: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  });

  const deleteProfile = useMutation({
    mutationFn: (id: number) => api.delete(`/api/profiles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
    onError: (err: unknown) => {
      const detail = (err as { detail?: { error?: string } }).detail;
      alert(detail?.error ?? 'Cannot delete profile');
    },
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createProfile.mutate({
      name: createForm.name,
      target_keywords: kwsToArray(createForm.target),
      excluded_keywords: kwsToArray(createForm.excluded),
    });
  }

  function startEdit(profile: Profile) {
    setEditing(profile.id);
    setEditForms((f) => ({
      ...f,
      [profile.id]: {
        name: profile.name,
        target: parseKws(profile.target_keywords),
        excluded: parseKws(profile.excluded_keywords),
      },
    }));
    setEditError(null);
  }

  function handleUpdate(e: React.FormEvent, id: number) {
    e.preventDefault();
    const form = editForms[id];
    if (!form) return;
    updateProfile.mutate({
      id,
      data: {
        name: form.name,
        target_keywords: kwsToArray(form.target),
        excluded_keywords: kwsToArray(form.excluded),
      },
    });
  }

  if (profilesQ.isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 text-muted text-sm">Loading…</div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center mb-6">
        <h1 className="text-lg font-semibold text-ink mr-auto">Profiles</h1>
        <button
          onClick={() => {
            setShowCreate(!showCreate);
            setCreateError(null);
          }}
          className="px-3 py-1.5 text-sm rounded border border-surface text-muted hover:text-ink hover:border-ink/40 transition-colors"
        >
          {showCreate ? 'Cancel' : '+ Create Profile'}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mb-6 p-4 border border-surface rounded-lg bg-surface/40 space-y-3"
        >
          <h2 className="text-sm font-medium text-ink">New Profile</h2>
          <div>
            <label className="block text-xs text-muted mb-1">Name *</label>
            <input
              required
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              className={inputCls}
              placeholder="IT / Infrastructure"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Target Keywords</label>
            <input
              value={createForm.target}
              onChange={(e) => setCreateForm((f) => ({ ...f, target: e.target.value }))}
              className={inputCls}
              placeholder="sysadmin, infrastructure engineer, IT support"
            />
            <p className="text-xs text-muted mt-1">
              Comma-separated. Jobs matching any of these pass the filter.
            </p>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Excluded Keywords</label>
            <input
              value={createForm.excluded}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, excluded: e.target.value }))
              }
              className={inputCls}
              placeholder="sales, account executive"
            />
            <p className="text-xs text-muted mt-1">
              Any match here scores the job 0 and hides it from the filtered view.
            </p>
          </div>
          {createError && <p className="text-xs text-red-400">{createError}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={createProfile.isPending}
              className="px-4 py-1.5 text-sm rounded bg-accent text-canvas hover:bg-accent/80 disabled:opacity-50 transition-colors"
            >
              {createProfile.isPending ? 'Creating…' : 'Create Profile'}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {profiles.length === 0 && (
          <p className="text-sm text-muted">No profiles yet.</p>
        )}

        {profiles.map((profile) => (
          <div key={profile.id} className="border border-surface rounded-lg bg-surface/20">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-ink">{profile.name}</span>
                  {!!profile.is_default && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent">
                      default
                    </span>
                  )}
                </div>
                {parseKws(profile.target_keywords) ? (
                  <div className="text-xs text-muted mt-0.5">
                    {parseKws(profile.target_keywords)}
                  </div>
                ) : (
                  <div className="text-xs text-muted/50 mt-0.5 italic">no target keywords</div>
                )}
                {parseKws(profile.excluded_keywords) && (
                  <div className="text-xs text-muted">
                    excluded: {parseKws(profile.excluded_keywords)}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {!profile.is_default && (
                  <button
                    onClick={() => setDefault.mutate(profile.id)}
                    disabled={setDefault.isPending}
                    className="text-xs px-2 py-1 rounded border border-surface text-muted hover:text-ink hover:border-ink/40 disabled:opacity-50 transition-colors"
                  >
                    Set default
                  </button>
                )}
                <button
                  onClick={() =>
                    editing === profile.id ? setEditing(null) : startEdit(profile)
                  }
                  className="text-xs px-2 py-1 rounded border border-surface text-muted hover:text-ink hover:border-ink/40 transition-colors"
                >
                  {editing === profile.id ? 'Cancel' : 'Edit'}
                </button>
                {!profile.is_default && (
                  <button
                    onClick={() => {
                      if (confirm(`Delete profile "${profile.name}"?`)) {
                        deleteProfile.mutate(profile.id);
                      }
                    }}
                    className="text-xs text-muted hover:text-red-400 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            {editing === profile.id && editForms[profile.id] && (
              <form
                onSubmit={(e) => handleUpdate(e, profile.id)}
                className="border-t border-surface px-4 py-3 space-y-3"
              >
                <div>
                  <label className="block text-xs text-muted mb-1">Name *</label>
                  <input
                    required
                    value={editForms[profile.id]!.name}
                    onChange={(e) =>
                      setEditForms((f) => ({
                        ...f,
                        [profile.id]: { ...f[profile.id]!, name: e.target.value },
                      }))
                    }
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Target Keywords</label>
                  <input
                    value={editForms[profile.id]!.target}
                    onChange={(e) =>
                      setEditForms((f) => ({
                        ...f,
                        [profile.id]: { ...f[profile.id]!, target: e.target.value },
                      }))
                    }
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Excluded Keywords</label>
                  <input
                    value={editForms[profile.id]!.excluded}
                    onChange={(e) =>
                      setEditForms((f) => ({
                        ...f,
                        [profile.id]: { ...f[profile.id]!, excluded: e.target.value },
                      }))
                    }
                    className={inputCls}
                  />
                </div>
                {editError && <p className="text-xs text-red-400">{editError}</p>}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={updateProfile.isPending}
                    className="px-3 py-1.5 text-sm rounded bg-accent text-canvas hover:bg-accent/80 disabled:opacity-50 transition-colors"
                  >
                    {updateProfile.isPending ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const inputCls =
  'w-full text-sm px-2 py-1.5 rounded bg-surface border border-surface text-ink';
