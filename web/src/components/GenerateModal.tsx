import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  type SystemPromptResponse,
  type SavedPrompt,
  type SavedPromptsListResponse,
  type SavedPromptResponse,
} from '../lib/api';

export function GenerateModal({
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
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [defaultPrompt, setDefaultPrompt] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [edited, setEdited] = useState(false);
  const [promptSource, setPromptSource] = useState<string>('__default__');
  const [savedList, setSavedList] = useState<SavedPrompt[] | null>(null);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function handleExpand() {
    setExpanded(true);
    if (defaultPrompt === null) {
      api.get<SystemPromptResponse>('/api/applications/prompt').then((r) => {
        setDefaultPrompt(r.prompt);
        setPrompt(r.prompt);
      });
    }
    if (savedList === null) {
      api.get<SavedPromptsListResponse>('/api/applications/prompts').then((r) => {
        setSavedList(r.prompts);
      });
    }
  }

  function handleSourceChange(value: string) {
    setPromptSource(value);
    if (value === '__default__') {
      setPrompt(defaultPrompt);
      setEdited(false);
      setShowSaveAs(false);
      setSaveAsName('');
      setSaveError(null);
    } else {
      const found = savedList?.find((p) => p.id === Number(value));
      if (found) {
        setPrompt(found.content);
        setEdited(true);
      }
    }
  }

  function handleReset() {
    setPrompt(defaultPrompt);
    setEdited(false);
    setPromptSource('__default__');
    setShowSaveAs(false);
    setSaveAsName('');
    setSaveError(null);
  }

  async function handleSave() {
    if (!saveAsName.trim() || !prompt) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api.post<SavedPromptResponse>('/api/applications/prompts', {
        name: saveAsName.trim(),
        content: prompt,
      });
      const newPrompt = result.prompt;
      setSavedList((prev) =>
        prev
          ? [...prev, newPrompt].sort((a, b) => a.name.localeCompare(b.name))
          : [newPrompt],
      );
      qc.invalidateQueries({ queryKey: ['prompts'] });
      setPromptSource(String(newPrompt.id));
      setShowSaveAs(false);
      setSaveAsName('');
    } catch (err: unknown) {
      const apiErr = err as { status?: number };
      setSaveError(
        apiErr.status === 409
          ? `"${saveAsName.trim()}" already exists — choose a different name.`
          : 'Failed to save prompt.',
      );
    } finally {
      setSaving(false);
    }
  }

  function handleConfirm() {
    onConfirm(edited && prompt != null ? prompt : undefined);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
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
            <div className="mt-3 space-y-2">
              {/* Saved prompt selector */}
              {savedList !== null && (
                <div>
                  <select
                    value={promptSource}
                    onChange={(e) => handleSourceChange(e.target.value)}
                    className="text-xs px-2 py-1 rounded bg-surface border border-surface text-muted w-full"
                  >
                    <option value="__default__">Default (built-in)</option>
                    {savedList.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {savedList.length === 0 && (
                    <p className="text-xs text-muted/60 mt-1">
                      No saved prompts yet — edit below and click "Save as…" to reuse later.
                    </p>
                  )}
                </div>
              )}

              {/* Prompt textarea */}
              {prompt === null ? (
                <p className="text-xs text-muted">Loading…</p>
              ) : (
                <textarea
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    setEdited(true);
                  }}
                  rows={12}
                  className="w-full text-xs px-2 py-1.5 rounded bg-surface border border-surface text-ink font-mono resize-y"
                />
              )}

              {/* Reset / Save as */}
              {prompt !== null && (
                <div className="flex items-center gap-3 flex-wrap">
                  {edited && (
                    <button
                      onClick={handleReset}
                      className="text-xs text-muted hover:text-ink transition-colors"
                    >
                      Reset to default
                    </button>
                  )}
                  {edited && !showSaveAs && (
                    <button
                      onClick={() => {
                        setShowSaveAs(true);
                        setSaveError(null);
                      }}
                      className="text-xs text-muted hover:text-ink transition-colors"
                    >
                      Save as…
                    </button>
                  )}
                </div>
              )}

              {/* Save-as inline form */}
              {showSaveAs && (
                <div className="space-y-1">
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={saveAsName}
                      onChange={(e) => {
                        setSaveAsName(e.target.value);
                        setSaveError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSave();
                        if (e.key === 'Escape') {
                          setShowSaveAs(false);
                          setSaveAsName('');
                        }
                      }}
                      placeholder="Prompt name…"
                      autoFocus
                      className="text-xs px-2 py-1 rounded bg-surface border border-surface text-ink flex-1 min-w-0"
                    />
                    <button
                      onClick={handleSave}
                      disabled={saving || !saveAsName.trim()}
                      className="text-xs px-2.5 py-1 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => {
                        setShowSaveAs(false);
                        setSaveAsName('');
                        setSaveError(null);
                      }}
                      className="text-xs text-muted hover:text-ink transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                  {saveError && <p className="text-xs text-red-400">{saveError}</p>}
                </div>
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
