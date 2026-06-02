import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ApplicationWithJob } from '../lib/api';

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
      </td>
      <td className="py-3 px-4 text-right">
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

  const submit = useMutation({
    mutationFn: (notes: string) =>
      api.post(`/api/applications/${appId}/submit`, { notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const regenerate = useMutation({
    mutationFn: () => api.post(`/api/applications/${appId}/regenerate`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      onClose();
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
              <h1 className="text-xl font-semibold text-ink">{app.job_title}</h1>
              <p className="text-muted text-sm mt-1">{app.job_company}</p>
              <div className="mt-2 flex items-center gap-3">
                <StatusBadge status={app.status} />
                {app.model_used && (
                  <span className="text-xs text-muted">{app.model_used}</span>
                )}
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
                <button
                  onClick={() => regenerate.mutate()}
                  disabled={regenerate.isPending}
                  className="text-xs px-3 py-1.5 rounded border border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/10 transition-colors disabled:opacity-50"
                >
                  {regenerate.isPending ? 'Queuing…' : 'Retry Generation'}
                </button>
              </div>
            )}

            {/* Actions */}
            {(app.status === 'ready' || app.status === 'applied') && (
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
