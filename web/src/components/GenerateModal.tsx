import { useState } from 'react';
import { api, type SystemPromptResponse } from '../lib/api';

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
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null); // null = not loaded yet
  const [edited, setEdited] = useState(false);

  function handleExpand() {
    setExpanded(true);
    if (prompt === null) {
      api.get<SystemPromptResponse>('/api/applications/prompt').then((r) => {
        setPrompt(r.prompt);
      });
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
            <div className="mt-3">
              {prompt === null ? (
                <p className="text-xs text-muted">Loading…</p>
              ) : (
                <>
                  <textarea
                    value={prompt}
                    onChange={(e) => { setPrompt(e.target.value); setEdited(true); }}
                    rows={12}
                    className="w-full text-xs px-2 py-1.5 rounded bg-surface border border-surface text-ink font-mono resize-y"
                  />
                  {edited && (
                    <button
                      onClick={() => { setEdited(false); setPrompt(null); handleExpand(); }}
                      className="mt-1 text-xs text-muted hover:text-ink transition-colors"
                    >
                      Reset to default
                    </button>
                  )}
                </>
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
