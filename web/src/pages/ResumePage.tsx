import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type MasterResume,
  type WritingSample,
  type WritingSampleKind,
  type ResumeResponse,
  type ResumeVersionsResponse,
  type WritingSamplesResponse,
} from '../lib/api';

const KIND_LABELS: Record<WritingSampleKind, string> = {
  cover_letter: 'Cover letter',
  email: 'Email',
  bio: 'Bio',
  other: 'Other',
};

const KIND_OPTIONS: WritingSampleKind[] = ['cover_letter', 'email', 'bio', 'other'];

export function ResumePage() {
  const qc = useQueryClient();

  const resumeQ = useQuery({
    queryKey: ['resume'],
    queryFn: ({ signal }) => api.get<ResumeResponse>('/api/resume', signal),
  });
  const versionsQ = useQuery({
    queryKey: ['resume', 'versions'],
    queryFn: ({ signal }) => api.get<ResumeVersionsResponse>('/api/resume/versions', signal),
  });
  const samplesQ = useQuery({
    queryKey: ['resume', 'writing-samples'],
    queryFn: ({ signal }) =>
      api.get<WritingSamplesResponse>('/api/resume/writing-samples', signal),
  });

  const invalidateResume = () => {
    qc.invalidateQueries({ queryKey: ['resume'] });
  };

  const resume = resumeQ.data?.resume ?? null;
  const versions = versionsQ.data?.versions ?? [];
  const samples = samplesQ.data?.samples ?? [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">
      <ResumeSection
        resume={resume}
        versions={versions}
        isLoading={resumeQ.isLoading}
        onSaved={invalidateResume}
      />
      <WritingSamplesSection
        samples={samples}
        isLoading={samplesQ.isLoading}
        onSaved={invalidateResume}
      />
    </div>
  );
}

// ─── Resume editor ────────────────────────────────────────────────────────────

function ResumeSection({
  resume,
  versions,
  isLoading,
  onSaved,
}: {
  resume: MasterResume | null;
  versions: MasterResume[];
  isLoading: boolean;
  onSaved: () => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const createResume = useMutation({
    mutationFn: (body: { content: string; notes: string }) =>
      api.post<{ resume: MasterResume }>('/api/resume', body),
    onSuccess: async (data) => {
      // Activate the new version immediately
      await api.patch(`/api/resume/${data.resume.id}/activate`, {});
      onSaved();
      setEditMode(false);
    },
  });

  const activateVersion = useMutation({
    mutationFn: (id: number) =>
      api.patch<{ resume: MasterResume }>(`/api/resume/${id}/activate`, {}),
    onSuccess: onSaved,
  });

  function startEdit() {
    setEditContent(resume ? resume.content : '{}');
    setEditNotes('');
    setJsonError(null);
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
    setJsonError(null);
  }

  function handleSave() {
    try {
      JSON.parse(editContent);
    } catch {
      setJsonError('Invalid JSON — fix the syntax before saving.');
      return;
    }
    setJsonError(null);
    createResume.mutate({ content: editContent, notes: editNotes });
  }

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-base font-semibold text-ink">Master Resume</h2>
        {resume && (
          <span className="text-xs bg-surface text-muted px-2 py-0.5 rounded">
            v{resume.version} · active
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {!editMode && (
            <button
              onClick={startEdit}
              disabled={isLoading}
              className="text-xs px-3 py-1.5 rounded bg-surface text-ink hover:bg-surface/80 transition-colors"
            >
              {resume ? 'Edit' : 'Create'}
            </button>
          )}
          {editMode && (
            <>
              <button
                onClick={cancelEdit}
                className="text-xs px-3 py-1.5 rounded text-muted hover:text-ink transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={createResume.isPending}
                className="text-xs px-3 py-1.5 rounded bg-accent text-ink hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {createResume.isPending ? 'Saving…' : 'Save as New Version'}
              </button>
            </>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="text-muted text-sm py-8 text-center">Loading…</div>
      )}

      {!isLoading && editMode && (
        <div className="space-y-2">
          {jsonError && (
            <div className="text-yellow-300 text-xs px-3 py-2 bg-yellow-500/10 rounded">
              {jsonError}
            </div>
          )}
          <textarea
            value={editContent}
            onChange={(e) => {
              setEditContent(e.target.value);
              setJsonError(null);
            }}
            className="w-full h-[600px] font-mono text-xs bg-surface border border-surface text-ink px-3 py-2 rounded resize-y focus:outline-none focus:border-accent/50"
            spellCheck={false}
          />
          <input
            type="text"
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            placeholder="Version notes (optional)"
            className="w-full text-sm px-3 py-1.5 rounded bg-surface border border-surface text-ink focus:outline-none"
          />
        </div>
      )}

      {!isLoading && !editMode && resume && (
        <pre className="text-xs font-mono bg-surface text-ink px-4 py-3 rounded overflow-x-auto max-h-[600px] overflow-y-auto">
          {resume.content}
        </pre>
      )}

      {!isLoading && !editMode && !resume && (
        <div className="text-muted text-sm py-12 text-center">
          No resume yet. Click Create to add one.
        </div>
      )}

      {versions.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs uppercase tracking-wide text-muted mb-2 font-medium">
            Version History
          </h3>
          <div className="space-y-1">
            {versions.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-3 text-sm px-3 py-2 rounded bg-surface/40"
              >
                <span className="text-ink font-medium w-8">v{v.version}</span>
                <span className="text-muted text-xs">
                  {new Date(v.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                {v.notes && (
                  <span className="text-muted text-xs truncate flex-1">{v.notes}</span>
                )}
                <div className="ml-auto">
                  {v.is_active ? (
                    <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded">
                      active
                    </span>
                  ) : (
                    <button
                      onClick={() => activateVersion.mutate(v.id)}
                      disabled={activateVersion.isPending}
                      className="text-xs text-muted hover:text-ink transition-colors"
                    >
                      Activate
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Writing samples ──────────────────────────────────────────────────────────

function WritingSamplesSection({
  samples,
  isLoading,
  onSaved,
}: {
  samples: WritingSample[];
  isLoading: boolean;
  onSaved: () => void;
}) {
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-base font-semibold text-ink">Writing Samples</h2>
        <span className="text-xs text-muted">Voice calibration for generation</span>
        <button
          onClick={() => { setAddingNew(true); setEditingId(null); }}
          className="ml-auto text-xs px-3 py-1.5 rounded bg-surface text-ink hover:bg-surface/80 transition-colors"
        >
          + Add Sample
        </button>
      </div>

      {isLoading && (
        <div className="text-muted text-sm py-8 text-center">Loading…</div>
      )}

      {addingNew && (
        <SampleForm
          onSave={() => { onSaved(); setAddingNew(false); }}
          onCancel={() => setAddingNew(false)}
        />
      )}

      <div className="space-y-3">
        {samples.map((s) =>
          editingId === s.id ? (
            <SampleForm
              key={s.id}
              initial={s}
              onSave={() => { onSaved(); setEditingId(null); }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <SampleCard
              key={s.id}
              sample={s}
              onEdit={() => { setEditingId(s.id); setAddingNew(false); }}
              onDelete={onSaved}
            />
          ),
        )}
      </div>

      {!isLoading && samples.length === 0 && !addingNew && (
        <div className="text-muted text-sm py-12 text-center">
          No writing samples yet. Add one to calibrate the generation voice.
        </div>
      )}
    </section>
  );
}

function SampleCard({
  sample,
  onEdit,
  onDelete,
}: {
  sample: WritingSample;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const deleteSample = useMutation({
    mutationFn: () => api.delete(`/api/resume/writing-samples/${sample.id}`),
    onSuccess: onDelete,
  });

  const preview = sample.content.slice(0, 200).replace(/\n/g, ' ');

  return (
    <div className="px-4 py-3 rounded bg-surface/40 space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink">{sample.label}</span>
        <span className="text-xs bg-surface text-muted px-2 py-0.5 rounded">
          {KIND_LABELS[sample.kind as WritingSampleKind] ?? sample.kind}
        </span>
        {!sample.active && (
          <span className="text-xs text-muted">(inactive)</span>
        )}
        <div className="ml-auto flex gap-3 text-xs">
          <button onClick={onEdit} className="text-muted hover:text-ink transition-colors">
            Edit
          </button>
          {confirming ? (
            <>
              <button
                onClick={() => deleteSample.mutate()}
                disabled={deleteSample.isPending}
                className="text-red-400 hover:text-red-300 transition-colors"
              >
                Confirm delete
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-muted hover:text-ink transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="text-muted hover:text-red-400 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted truncate">{preview}{sample.content.length > 200 ? '…' : ''}</p>
    </div>
  );
}

function SampleForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: WritingSample;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [kind, setKind] = useState<WritingSampleKind>(
    (initial?.kind as WritingSampleKind) ?? 'cover_letter',
  );
  const [content, setContent] = useState(initial?.content ?? '');
  const [error, setError] = useState<string | null>(null);

  const createSample = useMutation({
    mutationFn: (body: { label: string; kind: string; content: string }) =>
      api.post('/api/resume/writing-samples', body),
    onSuccess: onSave,
  });

  const updateSample = useMutation({
    mutationFn: (body: { label: string; kind: string; content: string }) =>
      api.patch(`/api/resume/writing-samples/${initial!.id}`, body),
    onSuccess: onSave,
  });

  function handleSave() {
    if (!label.trim()) { setError('Label is required.'); return; }
    if (!content.trim()) { setError('Content is required.'); return; }
    setError(null);
    const body = { label: label.trim(), kind, content };
    if (initial) {
      updateSample.mutate(body);
    } else {
      createSample.mutate(body);
    }
  }

  const isPending = createSample.isPending || updateSample.isPending;

  return (
    <div className="px-4 py-3 rounded bg-surface border border-surface space-y-3">
      {error && (
        <div className="text-yellow-300 text-xs">{error}</div>
      )}
      <div className="flex gap-3">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. Cover letter — IT analyst)"
          className="flex-1 text-sm px-3 py-1.5 rounded bg-canvas border border-surface text-ink focus:outline-none"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as WritingSampleKind)}
          className="text-sm px-3 py-1.5 rounded bg-canvas border border-surface text-ink focus:outline-none"
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Paste the full text of this writing sample…"
        className="w-full h-48 text-sm bg-canvas border border-surface text-ink px-3 py-2 rounded resize-y focus:outline-none"
        spellCheck={false}
      />
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded text-muted hover:text-ink transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isPending}
          className="text-xs px-3 py-1.5 rounded bg-accent text-ink hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {isPending ? 'Saving…' : initial ? 'Save Changes' : 'Add Sample'}
        </button>
      </div>
    </div>
  );
}
