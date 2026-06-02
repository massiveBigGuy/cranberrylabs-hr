import type { Job } from '../lib/api';
import { JobRow } from './JobRow';

interface JobListProps {
  jobs: Job[];
  onOpen: (id: number) => void;
  isLoading: boolean;
  isError: boolean;
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
}

export function JobList({
  jobs,
  onOpen,
  isLoading,
  isError,
  selectedIds,
  onToggle,
  onToggleAll,
}: JobListProps) {
  if (isLoading) {
    return (
      <div className="text-muted text-sm py-12 text-center">Loading…</div>
    );
  }

  if (isError) {
    return (
      <div className="text-yellow-300 text-sm py-12 text-center">
        Couldn't load jobs. Check the API logs.
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="text-muted text-sm py-12 text-center">
        No jobs match the current filter. Try widening the date range or adding more
        sources.
      </div>
    );
  }

  const allSelected = jobs.length > 0 && selectedIds.size === jobs.length;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-surface">
            <th className="py-2 pl-4 pr-1 w-8">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                className="w-3.5 h-3.5 cursor-pointer accent-accent"
                title={allSelected ? 'Deselect all' : 'Select all'}
              />
            </th>
            <th className="py-2 px-4 font-medium">Role / Company</th>
            <th className="py-2 px-4 font-medium">Location</th>
            <th className="py-2 px-4 font-medium">Remote</th>
            <th className="py-2 px-4 font-medium">Posted</th>
            <th className="py-2 px-4 font-medium">Fit</th>
            <th className="py-2 px-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <JobRow
              key={j.id}
              job={j}
              onOpen={() => onOpen(j.id)}
              selected={selectedIds.has(j.id)}
              onToggle={() => onToggle(j.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
