import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type ApplicationWithJob,
  type ApplicationVersion,
  type RetentionPolicy,
} from '../lib/api';

// ─── Page ────────────────────────────────────────────────────────────────────

export function ApplicationsPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['applications'],
    queryFn: ({ signal }) =>
      api.get<{ applications: ApplicationWithJob[] }>('/api/applications', signal),
  });

  const applications = data?.applications ?? [];
  const activeCount = applications.filter(
    (a) => a.status === 'queued' || a.status === 'generating',
  ).length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-base font-semibold text-ink">Applications</h1>
        {!isLoading && (
          <span className="text-xs text-muted">
            {applications.length} {applications.length === 1 ? 'application' : 'applications'}
          </span>
        )}
      </div>

      {/* Queue activity strip — only visible when jobs are in-flight */}
      {activeCount > 0 && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2 rounded bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          {activeCount} application{activeCount === 1 ? '' : 's'} in queue
        </div>
      )}

      {isLoading && (
        <div className="text-muted text-sm py-12 text-center">Loading…</div>
      )}

      {!isLoading && applications.length === 0 && (
        <div className="text-muted text-sm py-12 text-center">
          No applications yet. Open a job from the{' '}
          <a href="/jobs" className="text-accent hover:underline">Jobs page</a>
          {' '}and click Generate Application, or select multiple jobs and click Generate.
        </div>
      )}

      {applications.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface text-left">
                <th className="py-2 px-4 font-medium text-muted text-xs uppercase tracking-wide">
                  Job
                </th>
                <th className="py-2 px-4 font-medium text-muted text-xs uppercase tracking-wide">
                  Model
                </th>
                <th className="py-2 px-4 font-medium text-muted text-xs uppercase tracking-wide">
                  Status
                </th>
                <th className="py-2 px-4 font-medium text-muted text-xs uppercase tracking-wide">
                  Generated
                </th>
                <th className="py-2 px-4" />
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <ApplicationRow
                  key={app.id}
                  app={app}
                  onReview={() => setSelectedId(app.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ApplicationDetailDrawer
        appId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

// ─── Table row ───────────────────────────────────────────────────────────────

function ApplicationRow({
  app,
  onReview,
}: {
  app: ApplicationWithJob;
  onReview: () => void;
}) {
  const qc = useQueryClient();

  const pin = useMutation({
    mutationFn: () =>
      app.pinned_at
        ? api.delete(`/api/applications/${app.id}/pin`)
        : api.post(`/api/applications/${app.id}/pin`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
    },
  });

  return (
    <tr className="border-b border-surface/50 hover:bg-surface/20 transition-colors">
      <td className="py-3 px-4">
        <p className="text-ink font-medium">{app.job_title}</p>
        <p className="text-muted text-xs">{app.job_company}</p>
      </td>
      <td className="py-3 px-4 text-muted text-xs">{app.model_used ?? '—'}</td>
      <td className="py-3 px-4">
        <StatusBadge status={app.status} />
      </td>
      <td className="py-3 px-4 text-muted text-xs">
        {app.generated_at
          ? new Date(app.generated_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
          : '—'}
        <ExpiryBadge app={app} />
      </td>
      <td className="py-3 px-4 text-right flex items-center justify-end gap-2">
        <button
          onClick={() => pin.mutate()}
          disabled={pin.isPending}
          title={app.pinned_at ? 'Pinned — click to unpin' : 'Pin (never auto-deleted)'}
          className="text-base leading-none disabled:opacity-40 transition-colors"
          style={{ color: app.pinned_at ? '#f59e0b' : '#6b7280' }}
        >
          {app.pinned_at ? '★' : '☆'}
        </button>
        {app.status === 'ready' || app.status === 'applied' ? (
          <button
            onClick={onReview}
            className="text-xs text-accent hover:underline"
          >
            Review
          </button>
        ) : app.status === 'failed' ? (
          <button
            onClick={onReview}
            className="text-xs text-muted hover:text-ink transition-colors"
            title={app.generation_error ?? 'Generation failed'}
          >
            Details
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function ExpiryBadge({ app }: { app: ApplicationWithJob }) {
  if (app.pinned_at) {
    return (
      <p className="text-amber-400 text-[10px] mt-0.5" title={`Pinned ${new Date(app.pinned_at).toLocaleDateString()}`}>
        pinned
      </p>
    );
  }
  if (!app.expires_at) return null;

  const daysLeft = Math.floor(
    (new Date(app.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  if (daysLeft < 0) {
    return <p className="text-red-400 text-[10px] mt-0.5">expired</p>;
  }
  if (daysLeft === 0) {
    return <p className="text-red-400 text-[10px] mt-0.5">expires today</p>;
  }
  if (daysLeft <= 2) {
    return <p className="text-amber-400 text-[10px] mt-0.5">expires in {daysLeft}d</p>;
  }
  return <p className="text-muted text-[10px] mt-0.5">expires in {daysLeft}d</p>;
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    generating: 'bg-yellow-500/15 text-yellow-300',
    ready:      'bg-green-500/15 text-green-400',
    applied:    'bg-accent/20 text-accent',
    failed:     'bg-red-500/15 text-red-400',
    queued:     'bg-blue-500/15 text-blue-300',
    archived:   'bg-surface text-muted',
  };
  const labels: Record<string, string> = {
    generating: 'Generating…',
    ready:      'Ready',
    applied:    'Applied',
    failed:     'Failed',
    queued:     'Queued',
    archived:   'Archived',
  };
  return (
    <span
      className={`inline-flex items-center text-xs px-2 py-0.5 rounded ${
        styles[status] ?? 'bg-surface text-muted'
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

function ApplicationDetailDrawer({
  appId,
  onClose,
}: {
  appId: number | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const open = appId !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const { data, isLoading } = useQuery({
    queryKey: ['applications', appId],
    queryFn: ({ signal }) =>
      api.get<{ application: ApplicationWithJob }>(`/api/applications/${appId}`, signal),
    enabled: open,
  });

  const app = data?.application ?? null;
  const canFetchCover = open && !!app?.cover_letter_path;
  const { data: coverText } = useQuery({
    queryKey: ['applications', appId, 'cover'],
    queryFn: ({ signal }) => api.rawText(`/api/applications/${appId}/cover`, signal),
    enabled: canFetchCover,
  });

  const { data: policiesData } = useQuery({
    queryKey: ['retention', 'policies'],
    queryFn: ({ signal }) =>
      api.get<{ policies: RetentionPolicy[] }>('/api/retention/policies', signal),
    enabled: open,
  });
  const policies = policiesData?.policies ?? [];

  const submit = useMutation({
    mutationFn: (notes: string) =>
      api.post(`/api/applications/${appId}/submit`, { notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const regenerate = useMutation({
    mutationFn: (feedback?: string) =>
      api.post(`/api/applications/${appId}/regenerate`, { feedback }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['applications', appId, 'versions'] });
      onClose();
    },
  });

  const { data: versionsData } = useQuery({
    queryKey: ['applications', appId, 'versions'],
    queryFn: ({ signal }) =>
      api.get<{ versions: ApplicationVersion[] }>(
        `/api/applications/${appId}/versions`,
        signal,
      ),
    enabled: open && !!app?.cover_letter_path,
  });
  const versions = versionsData?.versions ?? [];

  const activateVersion = useMutation({
    mutationFn: (versionNo: number) =>
      api.post(`/api/applications/${appId}/versions/${versionNo}/activate`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['applications', appId] });
      qc.invalidateQueries({ queryKey: ['applications', appId, 'versions'] });
      qc.invalidateQueries({ queryKey: ['applications', appId, 'cover'] });
    },
  });

  const pin = useMutation({
    mutationFn: () =>
      app?.pinned_at
        ? api.delete(`/api/applications/${appId}/pin`)
        : api.post(`/api/applications/${appId}/pin`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['applications', appId] });
    },
  });

  const changePolicy = useMutation({
    mutationFn: (policy: string) =>
      api.patch(`/api/applications/${appId}/policy`, { policy }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['applications', appId] });
    },
  });

  const deleteApp = useMutation({
    mutationFn: () => api.delete(`/api/applications/${appId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      onClose();
    },
  });

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full max-w-2xl bg-canvas border-l border-surface z-50 overflow-y-auto"
        role="dialog"
        aria-modal="true"
      >
        <header className="sticky top-0 bg-canvas border-b border-surface px-6 py-4 flex items-center justify-between">
          <button onClick={onClose} className="text-muted hover:text-ink text-sm">
            ← Back
          </button>
          {app && (
            <a
              href={app.job_url}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-accent hover:underline"
            >
              View job posting ↗
            </a>
          )}
        </header>

        {isLoading && (
          <div className="px-6 py-8 text-muted text-sm">Loading…</div>
        )}

        {app && (
          <div className="px-6 py-6 space-y-6">
            <div>
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-xl font-semibold text-ink">{app.job_title}</h1>
                <button
                  onClick={() => pin.mutate()}
                  disabled={pin.isPending}
                  title={app.pinned_at ? 'Pinned — click to unpin' : 'Pin (never auto-deleted)'}
                  className="text-2xl leading-none flex-shrink-0 disabled:opacity-40 transition-colors"
                  style={{ color: app.pinned_at ? '#f59e0b' : '#6b7280' }}
                >
                  {app.pinned_at ? '★' : '☆'}
                </button>
              </div>
              <p className="text-muted text-sm mt-1">{app.job_company}</p>
              <div className="mt-2 flex items-center gap-3">
                <StatusBadge status={app.status} />
                {app.model_used && (
                  <span className="text-xs text-muted">{app.model_used}</span>
                )}
                <ExpiryBadge app={app} />
              </div>
            </div>

            {/* In-queue / generating state */}
            {(app.status === 'queued' || app.status === 'generating') && (
              <div className="px-4 py-3 rounded bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm">
                {app.status === 'queued'
                  ? 'Waiting in queue…'
                  : 'Generating cover letter and tailored resume…'}
              </div>
            )}

            {/* Error display + retry */}
            {app.status === 'failed' && (
              <div className="px-4 py-3 rounded bg-red-500/10 text-red-400 text-sm space-y-3">
                <div>
                  <p className="font-medium mb-1">Generation failed</p>
                  {app.generation_error && (
                    <p className="text-xs font-mono">{app.generation_error}</p>
                  )}
                </div>
                <RegenerateControl
                  isPending={regenerate.isPending}
                  onRegenerate={(feedback) => regenerate.mutate(feedback)}
                  label="Retry Generation"
                />
              </div>
            )}

            {/* Actions */}
            {(app.status === 'ready' || app.status === 'applied') && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {app.status === 'ready' && (
                    <SubmitControl
                      isPending={submit.isPending}
                      onSubmit={(notes) => submit.mutate(notes)}
                    />
                  )}
                  {app.status === 'applied' && app.submitted_at && (
                    <span className="text-xs text-muted py-1.5">
                      Applied {new Date(app.submitted_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                      {app.submission_notes ? ` · ${app.submission_notes}` : ''}
                    </span>
                  )}
                  <a
                    href={`/api/applications/${app.id}/cover`}
                    download
                    className="text-xs px-3 py-1.5 rounded border border-surface text-muted hover:text-ink hover:border-muted transition-colors"
                  >
                    Download Cover Letter
                  </a>
                  <a
                    href={`/api/applications/${app.id}/resume`}
                    download
                    className="text-xs px-3 py-1.5 rounded border border-surface text-muted hover:text-ink hover:border-muted transition-colors"
                  >
                    Download Resume JSON
                  </a>
                </div>
                <RegenerateControl
                  isPending={regenerate.isPending}
                  onRegenerate={(feedback) => regenerate.mutate(feedback)}
                  label="Regenerate with Feedback…"
                />
              </div>
            )}

            {/* Cover letter */}
            {app.cover_letter_path && (
              <section>
                <h2 className="text-sm uppercase tracking-wide text-muted mb-2">
                  Cover Letter
                </h2>
                {coverText ? (
                  <div className="whitespace-pre-wrap text-sm text-ink leading-relaxed bg-surface/40 px-4 py-3 rounded">
                    {coverText}
                  </div>
                ) : (
                  <div className="text-muted text-xs py-4 text-center">Loading…</div>
                )}
              </section>
            )}

            {/* Resume diff */}
            {app.resume_diff && (
              <section>
                <h2 className="text-sm uppercase tracking-wide text-muted mb-2">
                  Resume Changes
                </h2>
                <ResumeDiff diff={app.resume_diff} />
              </section>
            )}

            {/* Version history */}
            {versions.length > 1 && (
              <section>
                <h2 className="text-sm uppercase tracking-wide text-muted mb-2">
                  Version History
                </h2>
                <div className="space-y-2">
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      className={`px-3 py-2 rounded text-xs ${
                        v.is_current
                          ? 'bg-green-500/10 border border-green-500/20 text-green-300'
                          : 'bg-surface/40 text-muted'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink">
                          v{v.version_no}
                          {v.is_current ? ' (current)' : ''}
                        </span>
                        <span className="text-muted">
                          {new Date(v.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                      {v.model_used && (
                        <p className="text-muted mt-0.5">{v.model_used}</p>
                      )}
                      {v.feedback && (
                        <p className="mt-1 text-ink/70 italic">"{v.feedback}"</p>
                      )}
                      <div className="mt-2 flex gap-2">
                        {v.cover_letter_path && (
                          <a
                            href={`/api/applications/${app.id}/versions/${v.version_no}/cover`}
                            download
                            className="text-muted hover:text-ink transition-colors"
                          >
                            Cover ↓
                          </a>
                        )}
                        {v.resume_path && (
                          <a
                            href={`/api/applications/${app.id}/versions/${v.version_no}/resume`}
                            download
                            className="text-muted hover:text-ink transition-colors"
                          >
                            Resume ↓
                          </a>
                        )}
                        {!v.is_current && (
                          <button
                            onClick={() => activateVersion.mutate(v.version_no)}
                            disabled={activateVersion.isPending}
                            className="text-accent hover:underline disabled:opacity-50"
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Retention */}
            <div className="pt-2 border-t border-surface space-y-3">
              <h2 className="text-sm uppercase tracking-wide text-muted">Retention</h2>
              <div className="flex items-center gap-3">
                <label className="text-xs text-muted w-14 flex-shrink-0">Policy</label>
                <select
                  value={app.retention_policy}
                  disabled={changePolicy.isPending || policies.length === 0}
                  onChange={(e) => changePolicy.mutate(e.target.value)}
                  className="text-xs px-2 py-1 rounded bg-surface border border-surface text-ink disabled:opacity-50"
                >
                  {policies.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                      {p.ttl_days !== null ? ` (${p.ttl_days}d)` : ' (forever)'}
                      {p.description ? ` — ${p.description}` : ''}
                    </option>
                  ))}
                  {policies.length === 0 && (
                    <option value={app.retention_policy}>{app.retention_policy}</option>
                  )}
                </select>
              </div>
              {app.pinned_at ? (
                <p className="text-xs text-amber-400">
                  Pinned on {new Date(app.pinned_at).toLocaleDateString()} — exempt from auto-deletion
                </p>
              ) : app.expires_at ? (
                <ExpiryBadge app={app} />
              ) : (
                <p className="text-xs text-muted">No expiry set</p>
              )}
            </div>

            {/* Delete */}
            <div className="pt-2 border-t border-surface">
              <DeleteControl
                isPending={deleteApp.isPending}
                onDelete={() => deleteApp.mutate()}
              />
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

// ─── Diff viewer ─────────────────────────────────────────────────────────────

function ResumeDiff({ diff }: { diff: string }) {
  let changes: Array<{ key: string; from: unknown; to: unknown }>;
  try {
    changes = JSON.parse(diff);
  } catch {
    return <p className="text-muted text-xs italic">Diff format error.</p>;
  }

  if (changes.length === 0) {
    return (
      <p className="text-muted text-sm italic">
        No structural changes from the master resume.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {changes.map((change) => (
        <div key={change.key} className="rounded bg-surface/40 px-3 py-2 space-y-2">
          <p className="text-xs font-medium text-ink uppercase tracking-wide">
            {change.key}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted mb-1">Before</p>
              <pre className="text-xs text-muted whitespace-pre-wrap overflow-x-auto max-h-40">
                {JSON.stringify(change.from, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-green-400 mb-1">After</p>
              <pre className="text-xs text-ink whitespace-pre-wrap overflow-x-auto max-h-40">
                {JSON.stringify(change.to, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Local controls ───────────────────────────────────────────────────────────

function RegenerateControl({
  onRegenerate,
  isPending,
  label,
}: {
  onRegenerate: (feedback?: string) => void;
  isPending: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={isPending}
        className="text-xs px-3 py-1.5 rounded border border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/10 transition-colors disabled:opacity-50"
      >
        {isPending ? 'Queuing…' : label}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Optional feedback for the model (e.g. 'Emphasize Kubernetes experience', 'Shorten to 3 paragraphs')"
        className="w-full text-sm px-3 py-2 rounded bg-surface border border-surface text-ink resize-none"
        rows={3}
        autoFocus
      />
      <div className="flex gap-2">
        <button
          onClick={() => {
            onRegenerate(feedback.trim() || undefined);
            setOpen(false);
            setFeedback('');
          }}
          disabled={isPending}
          className="text-xs px-3 py-1.5 rounded border border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/10 transition-colors disabled:opacity-50"
        >
          {isPending ? 'Queuing…' : 'Regenerate'}
        </button>
        <button
          onClick={() => { setOpen(false); setFeedback(''); }}
          className="text-xs px-2 py-1.5 text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SubmitControl({
  onSubmit,
  isPending,
}: {
  onSubmit: (notes: string) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={isPending}
        className="text-xs px-3 py-1.5 rounded border border-accent bg-accent/20 text-ink hover:bg-accent/30 transition-colors disabled:opacity-50"
      >
        Mark Applied…
      </button>
    );
  }

  return (
    <div className="flex gap-2 items-center">
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (e.g. applied via Workday)"
        className="text-sm px-2 py-1.5 rounded bg-surface border border-surface text-ink w-52"
        autoFocus
      />
      <button
        onClick={() => { onSubmit(notes); setOpen(false); }}
        disabled={isPending}
        className="text-xs px-3 py-1.5 rounded bg-accent/30 text-ink hover:bg-accent/50 disabled:opacity-50"
      >
        Confirm
      </button>
      <button
        onClick={() => { setOpen(false); setNotes(''); }}
        className="text-xs px-2 py-1.5 text-muted hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );
}

function DeleteControl({
  onDelete,
  isPending,
}: {
  onDelete: () => void;
  isPending: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        disabled={isPending}
        className="text-xs text-muted hover:text-red-400 transition-colors disabled:opacity-50"
      >
        Delete application
      </button>
    );
  }

  return (
    <div className="flex gap-3 items-center">
      <button
        onClick={onDelete}
        disabled={isPending}
        className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
      >
        Confirm delete
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-xs text-muted hover:text-ink transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
