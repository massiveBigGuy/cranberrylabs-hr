import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Profile } from '../lib/api';

interface Props {
  profiles: Profile[];
  onClose: () => void;
}

export function AddJobModal({ profiles, onClose }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: '',
    company: '',
    description: '',
    url: '',
    location: '',
    remote_type: '',
    profile_id: '',
    posted_date: '',
  });
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setError(null);
  }

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post<{ job: unknown }>('/api/jobs/manual', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      onClose();
    },
    onError: (err: unknown) => {
      const detail = (err as { detail?: { error?: string } }).detail;
      setError(detail?.error ?? 'Failed to add job. Please try again.');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      title: form.title,
      company: form.company,
      description: form.description,
    };
    if (form.url) payload.url = form.url;
    if (form.location) payload.location = form.location;
    if (form.remote_type) payload.remote_type = form.remote_type;
    if (form.profile_id) payload.profile_id = Number(form.profile_id);
    if (form.posted_date) payload.posted_date = form.posted_date;
    mutation.mutate(payload);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-canvas border border-surface rounded-lg w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold text-ink mb-4">Add Job Manually</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Title *">
            <input
              required
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              className={inputCls}
              placeholder="Senior Systems Administrator"
            />
          </Field>

          <Field label="Company *">
            <input
              required
              value={form.company}
              onChange={(e) => set('company', e.target.value)}
              className={inputCls}
              placeholder="Acme Corp"
            />
          </Field>

          <Field label="Description *">
            <textarea
              required
              rows={6}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className={`${inputCls} resize-y`}
              placeholder="Paste the job description here…"
            />
          </Field>

          <Field label="Posting URL">
            <input
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              className={inputCls}
              placeholder="https://…"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Location">
              <input
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
                className={inputCls}
                placeholder="Toronto, ON"
              />
            </Field>
            <Field label="Remote Type">
              <select
                value={form.remote_type}
                onChange={(e) => set('remote_type', e.target.value)}
                className={inputCls}
              >
                <option value="">Not specified</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">Onsite</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Profile">
              <select
                value={form.profile_id}
                onChange={(e) => set('profile_id', e.target.value)}
                className={inputCls}
              >
                <option value="">Default profile</option>
                {profiles.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                    {p.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Posted Date">
              <input
                type="date"
                value={form.posted_date}
                onChange={(e) => set('posted_date', e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-muted hover:text-ink transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-1.5 text-sm rounded bg-accent text-canvas hover:bg-accent/80 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? 'Adding…' : 'Add Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  'w-full text-sm px-2 py-1.5 rounded bg-surface border border-surface text-ink';

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1">{label}</label>
      {children}
    </div>
  );
}
