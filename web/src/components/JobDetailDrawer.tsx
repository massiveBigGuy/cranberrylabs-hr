import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type Job, type JobDetailResponse, type Tag, type ApplicationWithJob } from '../lib/api';
import { GenerateModal } from './GenerateModal';

interface JobDetailDrawerProps {
  jobId: number | null;
  onClose: () => void;
}

/**
 * Slide-out panel for the selected job. Renders nothing when jobId is
 * null. Fetches on open and refetches when the underlying job is
 * mutated (status change, tag add) via React Query's invalidations.
 *
 * Why a drawer not a route: we want to preserve the list's scroll
 * position and current filter while inspecting. A route swap loses
 * that. A drawer over the table is the standard pattern (Linear,
 * Notion, GitHub PR review). If we want deep-linkable detail pages
 * later, /jobs/:id can be added without touching this component —
 * route + drawer can coexist.
 */
export function JobDetailDrawer({ jobId, onClose }: JobDetailDrawerProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const open = jobId !== null;

  // Close on ESC. Listener registered only while open to avoid
  // intercepting keystrokes in other contexts.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['jobs', jobId],
    queryFn: ({ signal }) =>
      api.get<JobDetailResponse>(`/api/jobs/${jobId}`, signal),
    enabled: open,
  });

  const setStatus = useMutation({
    mutationFn: (status: Job['status']) =>
      api.patch<{ job: Job }>(`/api/jobs/${jobId}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const dismiss = useMutation({
    mutationFn: (reason: string) =>
      api.post<{ job: Job }>(`/api/jobs/${jobId}/dismiss`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const addTag = useMutation({
    mutationFn: (tag: string) =>
      api.post<{ tag: Tag }>(`/api/jobs/${jobId}/tags`, { tag }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs', jobId] });
    },
  });

  const removeTag = useMutation({
    mutationFn: (tagId: number) =>
      api.delete(`/api/jobs/${jobId}/tags/${tagId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs', jobId] });
    },
  });

  // Check whether an application already exists for this job.
  const { data: appData } = useQuery({
    queryKey: ['applications', 'by-job', jobId],
    queryFn: ({ signal }) =>
      api.get<{ applications: ApplicationWithJob[] }>(
        `/api/applications?job_id=${jobId}`,
        signal,
      ),
    enabled: open,
  });
  const existingApp = appData?.applications[0] ?? null;

  const generate = useMutation({
    mutationFn: ({ adapterName, systemPrompt }: { adapterName: 'anthropic' | 'ollama'; systemPrompt?: string }) =>
      api.post<{ application: ApplicationWithJob }>('/api/applications', {
        job_id: jobId,
        adapter: adapterName,
        ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      navigate('/applications');
      onClose();
    },
  });

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <aside
        className="fixed top-0 right-0 bottom-0 w-full max-w-2xl bg-canvas border-l border-surface z-50 overflow-y-auto"
        role="dialog"
        aria-modal="true"
      >
        <header className="sticky top-0 bg-canvas border-b border-surface px-6 py-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="text-muted hover:text-ink text-sm"
            aria-label="Close"
          >
            ← Back
          </button>
          {data?.job && (
            <a
              href={data.job.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-accent hover:underline"
            >
              View on company site ↗
            </a>
          )}
        </header>

        {isLoading && (
          <div className="px-6 py-8 text-muted text-sm">Loading…</div>
        )}
        {isError && (
          <div className="px-6 py-8 text-yellow-300 text-sm">
            Couldn't load job detail.
          </div>
        )}

        {data?.job && (
          <div className="px-6 py-6 space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-ink">{data.job.title}</h1>
              <p className="text-muted text-sm mt-1">
                {data.job.company}
                {data.job.location ? ` · ${data.job.location}` : ''}
                {data.job.remote_type ? ` · ${data.job.remote_type}` : ''}
              </p>
              {data.job.posted_date && (
                <p className="text-xs text-muted mt-1">
                  Posted {data.job.posted_date}
                </p>
              )}
            </div>

            {/* Action bar */}
            <div className="flex flex-wrap gap-2">
              <StatusButton
                label="Mark Reviewing"
                onClick={() => setStatus.mutate('reviewing')}
                active={data.job.status === 'reviewing'}
                disabled={setStatus.isPending}
              />
              <StatusButton
                label="Mark Applied"
                onClick={() => setStatus.mutate('applied')}
                active={data.job.status === 'applied'}
                disabled={setStatus.isPending}
              />
              <DismissControl
                disabled={dismiss.isPending}
                onDismiss={(reason) => dismiss.mutate(reason)}
              />
              <GenerateControl
                existing={existingApp}
                isPending={generate.isPending}
                error={generate.error as Error | null}
                onGenerate={(adapter, systemPrompt) => generate.mutate({ adapterName: adapter, systemPrompt })}
              />
            </div>

            {/* Tags */}
            <TagsSection
              tags={data.tags}
              onAdd={(name) => addTag.mutate(name)}
              onRemove={(tagId) => removeTag.mutate(tagId)}
              isAddPending={addTag.isPending}
            />

            {/* Description */}
            <section>
              <h2 className="text-sm uppercase tracking-wide text-muted mb-2">
                Description
              </h2>
              <div className="whitespace-pre-wrap text-sm text-ink leading-relaxed">
                {data.job.description || (
                  <span className="text-muted italic">
                    Description not yet fetched. The detail sweep runs hourly.
                  </span>
                )}
              </div>
            </section>
          </div>
        )}
      </aside>
    </>
  );
}

// ---------- Local subcomponents ----------

function StatusButton(props: {
  label: string;
  onClick: () => void;
  active: boolean;
  disabled: boolean;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={`text-sm px-3 py-1.5 rounded border transition-colors ${
        props.active
          ? 'border-accent bg-accent/20 text-ink'
          : 'border-surface text-muted hover:text-ink hover:border-muted'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {props.label}
    </button>
  );
}

function DismissControl({
  onDismiss,
  disabled,
}: {
  onDismiss: (reason: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="text-sm px-3 py-1.5 rounded border border-surface text-muted hover:text-ink hover:border-muted transition-colors disabled:opacity-50"
      >
        Dismiss…
      </button>
    );
  }
  return (
    <div className="flex gap-2 items-center">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (e.g. wrong-stack)"
        className="text-sm px-2 py-1.5 rounded bg-surface border border-surface text-ink"
        autoFocus
      />
      <button
        onClick={() => {
          onDismiss(reason);
          setOpen(false);
          setReason('');
        }}
        disabled={disabled}
        className="text-sm px-3 py-1.5 rounded bg-accent/30 text-ink hover:bg-accent/50"
      >
        Confirm
      </button>
      <button
        onClick={() => {
          setOpen(false);
          setReason('');
        }}
        className="text-sm px-2 py-1.5 text-muted hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );
}

function GenerateControl({
  existing,
  isPending,
  error,
  onGenerate,
}: {
  existing: ApplicationWithJob | null;
  isPending: boolean;
  error: Error | null;
  onGenerate: (adapter: 'anthropic' | 'ollama', systemPrompt?: string) => void;
}) {
  const [adapter, setAdapter] = useState<'anthropic' | 'ollama'>('anthropic');
  const [showModal, setShowModal] = useState(false);

  if (existing) {
    return (
      <a
        href="/applications"
        className="text-sm px-3 py-1.5 rounded border border-surface text-accent hover:border-accent transition-colors"
      >
        View Application →
      </a>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2 items-center">
        <select
          value={adapter}
          onChange={(e) => setAdapter(e.target.value as 'anthropic' | 'ollama')}
          disabled={isPending}
          className="text-xs px-2 py-1.5 rounded bg-surface border border-surface text-muted disabled:opacity-50"
        >
          <option value="anthropic">Claude (Anthropic)</option>
          <option value="ollama">Ollama (local)</option>
        </select>
        <button
          onClick={() => setShowModal(true)}
          disabled={isPending}
          className="text-sm px-3 py-1.5 rounded border border-accent bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? 'Queuing…' : 'Generate Application'}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-400 max-w-xs truncate" title={error.message}>
          {error.message}
        </p>
      )}
      {showModal && (
        <GenerateModal
          jobCount={1}
          adapter={adapter}
          onConfirm={(systemPrompt) => {
            setShowModal(false);
            onGenerate(adapter, systemPrompt);
          }}
          onCancel={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

function TagsSection({
  tags,
  onAdd,
  onRemove,
  isAddPending,
}: {
  tags: Tag[];
  onAdd: (name: string) => void;
  onRemove: (tagId: number) => void;
  isAddPending: boolean;
}) {
  const [draft, setDraft] = useState('');

  return (
    <section>
      <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Tags</h2>
      <div className="flex flex-wrap gap-2 items-center">
        {tags.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-surface text-ink"
          >
            {t.name}
            <button
              onClick={() => onRemove(t.id)}
              className="text-muted hover:text-ink ml-1"
              aria-label={`Remove tag ${t.name}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              onAdd(draft.trim());
              setDraft('');
            }
          }}
          disabled={isAddPending}
          placeholder="Add tag…"
          className="text-xs px-2 py-1 rounded bg-surface border border-surface text-ink w-32"
        />
      </div>
    </section>
  );
}
