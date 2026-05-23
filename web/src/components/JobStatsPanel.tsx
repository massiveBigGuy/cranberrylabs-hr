import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * Mirrors the JobStats interface from the API (jobs/repo.ts).
 */
interface JobStats {
  total: number;
  by_status: Record<string, number>;
  passing_keyword_filter: number;
  filtered_out_by_keywords: number;
  missing_description: number;
  detail_fetch: {
    pending: number;
    ok: number;
    gave_up: number;
  };
}

/**
 * Collapsible diagnostic panel for the JobsPage. Answers the question
 * "I scraped 845 jobs, why am I only seeing 35?" by breaking the
 * number down: status distribution, keyword-filter pass/fail, and
 * detail-fetch state.
 *
 * Read-only. Not a SQL console — just the aggregates that explain the
 * gap between scraped and shown. Collapsed by default so it doesn't
 * clutter the main view.
 */
export function JobStatsPanel() {
  const [open, setOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['jobs', 'stats'],
    queryFn: ({ signal }) => api.get<JobStats>('/api/jobs/stats', signal),
    // Only fetch once the panel is opened — no point loading stats
    // for a panel nobody expanded.
    enabled: open,
  });

  return (
    <div className="mb-4 border border-surface rounded">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2 flex items-center justify-between text-sm text-muted hover:text-ink transition-colors"
      >
        <span>Database breakdown</span>
        <span className="text-xs">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-4 py-3 border-t border-surface text-sm">
          {isLoading && <div className="text-muted">Loading stats…</div>}
          {isError && (
            <div className="text-yellow-300">Couldn't load stats.</div>
          )}
          {data && <StatsBody stats={data} />}
        </div>
      )}
    </div>
  );
}

function StatsBody({ stats }: { stats: JobStats }) {
  // Status rows sorted by count desc so the dominant states read first.
  const statusEntries = Object.entries(stats.by_status).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
      {/* Totals */}
      <div>
        <h3 className="text-xs uppercase tracking-wide text-muted mb-2">
          Totals
        </h3>
        <StatLine label="Scraped (all)" value={stats.total} />
        <StatLine
          label="Pass keyword filter"
          value={stats.passing_keyword_filter}
        />
        <StatLine
          label="Filtered out"
          value={stats.filtered_out_by_keywords}
          muted
        />
        <StatLine
          label="Missing description"
          value={stats.missing_description}
          muted
        />
      </div>

      {/* Status breakdown */}
      <div>
        <h3 className="text-xs uppercase tracking-wide text-muted mb-2">
          By status
        </h3>
        {statusEntries.length === 0 && (
          <div className="text-muted text-xs">No jobs yet.</div>
        )}
        {statusEntries.map(([status, n]) => (
          <StatLine key={status} label={status} value={n} />
        ))}
      </div>

      {/* Detail-fetch state */}
      <div>
        <h3 className="text-xs uppercase tracking-wide text-muted mb-2">
          Detail fetch
        </h3>
        <StatLine label="Fetched (ok)" value={stats.detail_fetch.ok} />
        <StatLine label="Pending" value={stats.detail_fetch.pending} />
        <StatLine
          label="Gave up"
          value={stats.detail_fetch.gave_up}
          warn={stats.detail_fetch.gave_up > 0}
        />
        {stats.detail_fetch.gave_up > 0 && (
          <p className="text-xs text-muted mt-2">
            Jobs the scraper couldn't fetch a description for after
            repeated attempts. They still appear in the list, without a
            description.
          </p>
        )}
      </div>
    </div>
  );
}

function StatLine(props: {
  label: string;
  value: number;
  muted?: boolean;
  warn?: boolean;
}) {
  const valueClass = props.warn
    ? 'text-yellow-300'
    : props.muted
    ? 'text-muted'
    : 'text-ink';
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted capitalize">{props.label}</span>
      <span className={valueClass}>{props.value}</span>
    </div>
  );
}
