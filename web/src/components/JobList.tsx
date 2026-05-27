import type { Job } from '../lib/api';
import { JobRow } from './JobRow';

interface JobListProps {
  jobs: Job[];
  onOpen: (id: number) => void;
  isLoading: boolean;
  isError: boolean;
}

export function JobList({ jobs, onOpen, isLoading, isError }: JobListProps) {
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-surface">
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
            <JobRow key={j.id} job={j} onOpen={() => onOpen(j.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
