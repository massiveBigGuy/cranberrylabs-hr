import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type SystemPromptResponse,
  type SavedPrompt,
  type SavedPromptsListResponse,
  type SavedPromptResponse,
} from '../lib/api';

export function PromptsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data: defaultData } = useQuery({
    queryKey: ['prompt', 'default'],
    queryFn: ({ signal }) =>
      api.get<SystemPromptResponse>('/api/applications/prompt', signal),
  });

  const { data: promptsData, isLoading } = useQuery({
    queryKey: ['prompts'],
    queryFn: ({ signal }) =>
      api.get<SavedPromptsListResponse>('/api/applications/prompts', signal),
  });
  const prompts = promptsData?.prompts ?? [];

  const createMutation = useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      api.post<SavedPromptResponse>('/api/applications/prompts', { name, content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prompts'] });
      setShowCreate(false);
      setCreateName('');
      setCreateContent('');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name, content }: { id: number; name: string; content: string }) =>
      api.patch<SavedPromptResponse>(`/api/applications/prompts/${id}`, { name, content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prompts'] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/applications/prompts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prompts'] });
      setDeletingId(null);
    },
  });

  function startCreate() {
    setShowCreate(true);
    setCreateName('');
    setCreateContent(defaultData?.prompt ?? '');
    setEditingId(null);
    updateMutation.reset();
  }

  function startEdit(prompt: SavedPrompt) {
    setEditingId(prompt.id);
    setEditName(prompt.name);
    setEditContent(prompt.content);
    setShowCreate(false);
    updateMutation.reset();
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">
      <h1 className="text-lg font-semibold text-ink">Prompts</h1>

      {/* Default system prompt */}
      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Default system prompt</h2>
          <p className="text-xs text-muted mt-0.5">
            Built-in prompt used when no override is selected. Read-only here — create saved prompts below to customise.
          </p>
        </div>
        <textarea
          readOnly
          value={defaultData?.prompt ?? ''}
          rows={10}
          className="w-full text-xs px-3 py-2 rounded bg-surface border border-surface text-muted font-mono resize-y cursor-default select-all"
        />
      </section>

      {/* Saved prompts */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Saved prompts</h2>
            <p className="text-xs text-muted mt-0.5">
              Pick a saved prompt from the Generate dialog to override the default for that generation.
            </p>
          </div>
          {!showCreate && (
            <button
              onClick={startCreate}
              className="text-xs px-3 py-1.5 rounded border border-surface text-muted hover:text-ink hover:border-muted transition-colors flex-shrink-0"
            >
              + New prompt
            </button>
          )}
        </div>

        {/* Create card */}
        {showCreate && (
          <div className="rounded border border-surface bg-surface/20 px-4 py-3 space-y-2">
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Prompt name…"
              autoFocus
              className="w-full text-sm px-2 py-1.5 rounded bg-surface border border-surface text-ink"
            />
            <textarea
              value={createContent}
              onChange={(e) => setCreateContent(e.target.value)}
              rows={10}
              className="w-full text-xs px-2 py-1.5 rounded bg-surface border border-surface text-ink font-mono resize-y"
            />
            {createMutation.isError && (
              <p className="text-xs text-red-400">
                {(createMutation.error as { status?: number }).status === 409
                  ? `A prompt named "${createName}" already exists.`
                  : 'Failed to save — please try again.'}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() =>
                  createMutation.mutate({ name: createName.trim(), content: createContent })
                }
                disabled={createMutation.isPending || !createName.trim() || !createContent.trim()}
                className="text-xs px-3 py-1.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-50"
              >
                {createMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setShowCreate(false);
                  setCreateName('');
                  setCreateContent('');
                  createMutation.reset();
                }}
                className="text-xs px-2 py-1.5 text-muted hover:text-ink transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="text-muted text-sm py-6 text-center">Loading…</div>
        )}

        {/* Empty state */}
        {!isLoading && prompts.length === 0 && !showCreate && (
          <div className="text-muted text-sm py-6 text-center">
            No saved prompts yet.{' '}
            <button onClick={startCreate} className="text-accent hover:underline">
              Create one
            </button>{' '}
            to override the default prompt on any generation.
          </div>
        )}

        {/* Prompt cards */}
        {prompts.map((prompt) => (
          <div key={prompt.id} className="rounded border border-surface bg-surface/10 px-4 py-3">
            {editingId === prompt.id ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full text-sm px-2 py-1.5 rounded bg-surface border border-surface text-ink"
                  autoFocus
                />
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={10}
                  className="w-full text-xs px-2 py-1.5 rounded bg-surface border border-surface text-ink font-mono resize-y"
                />
                {updateMutation.isError && (
                  <p className="text-xs text-red-400">
                    {(updateMutation.error as { status?: number }).status === 409
                      ? `A prompt named "${editName}" already exists.`
                      : 'Failed to save — please try again.'}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      updateMutation.mutate({
                        id: prompt.id,
                        name: editName.trim(),
                        content: editContent,
                      })
                    }
                    disabled={
                      updateMutation.isPending || !editName.trim() || !editContent.trim()
                    }
                    className="text-xs px-3 py-1.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-50"
                  >
                    {updateMutation.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null);
                      updateMutation.reset();
                    }}
                    className="text-xs px-2 py-1.5 text-muted hover:text-ink transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : deletingId === prompt.id ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-ink">
                  Delete <span className="font-medium">"{prompt.name}"</span>?
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => deleteMutation.mutate(prompt.id)}
                    disabled={deleteMutation.isPending}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                  </button>
                  <button
                    onClick={() => setDeletingId(null)}
                    className="text-xs text-muted hover:text-ink transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{prompt.name}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {new Date(prompt.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                      {prompt.updated_at !== prompt.created_at && (
                        <span>
                          {' · updated '}
                          {new Date(prompt.updated_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-3 flex-shrink-0">
                    <button
                      onClick={() => startEdit(prompt)}
                      className="text-xs text-muted hover:text-ink transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeletingId(prompt.id)}
                      className="text-xs text-muted hover:text-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted font-mono line-clamp-2 leading-relaxed">
                  {prompt.content}
                </p>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
