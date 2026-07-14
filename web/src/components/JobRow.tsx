import type { Job } from '../lib/api';

interface JobRowProps {
  job: Job;
  onOpen: () => void;
  selected: boolean;
  onToggle: () => void;
}

const STATUS_STYLES: Record<Job['status'], string> = {
  new: 'bg-surface text-ink',
  reviewing: 'bg-yellow-500/20 text-yellow-300',
  dismissed: 'bg-surface text-muted line-through',
  queued: 'bg-blue-500/20 text-blue-300',
  generating: 'bg-blue-500/20 text-blue-300 animate-pulse',
  ready: 'bg-green-500/20 text-green-300',
  applied: 'bg-accent/30 text-ink',
  archived: 'bg-surface text-muted',
  duplicate: 'bg-surface text-muted line-through',
};

export function JobRow({ job, onOpen, selected, onToggle }: JobRowProps) {
  const posted = job.posted_date ?? job.discovered_at;
  const postedDisplay = posted ? formatRelative(posted) : '—';

  return (
    <tr
      onClick={onOpen}
      className={`border-b border-surface hover:bg-surface/60 cursor-pointer transition-colors ${
        selected ? 'bg-surface/40' : ''
      }`}
    >
      {/* Checkbox cell — stopPropagation prevents the row click from firing */}
      <td
        className="py-3 pl-4 pr-1 w-8"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="w-3.5 h-3.5 cursor-pointer accent-accent"
        />
      </td>
      <td className="py-3 px-4">
        <div className="font-medium text-ink">{job.title}</div>
        <div className="text-xs text-muted">{job.company}</div>
      </td>
      <td className="py-3 px-4 text-sm text-muted">{job.location ?? '—'}</td>
      <td className="py-3 px-4 text-sm text-muted">{job.remote_type ?? '—'}</td>
      <td className="py-3 px-4 text-sm text-muted">{postedDisplay}</td>
      <td className="py-3 px-4 text-sm">
        <FitBadge score={job.fit_score} />
      </td>
      <td className="py-3 px-4">
        <span className={`text-xs px-2 py-1 rounded ${STATUS_STYLES[job.status]}`}>
          {job.status}
        </span>
      </td>
    </tr>
  );
}

function FitBadge({ score }: { score: number | null }) {
  if (score === null || score === 0) {
    return <span className="text-muted">—</span>;
  }
  const pct = Math.round(score * 100);
  const color =
    score >= 0.5
      ? 'text-green-300'
      : score >= 0.15
      ? 'text-yellow-300'
      : 'text-muted';
  return <span className={color}>{pct}%</span>;
}

function formatRelative(iso: string): string {
  const then = new Date(iso);
  if (isNaN(then.getTime())) return iso;
  const now = new Date();
  const ms = now.getTime() - then.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
