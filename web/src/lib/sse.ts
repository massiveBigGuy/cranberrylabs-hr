import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * EventSource subscription that translates server-pushed events into
 * React Query cache invalidations. Mounting this once at the app root
 * keeps a single connection alive for the lifetime of the session;
 * unmounting closes it cleanly.
 *
 * Event taxonomy (per §4 of the schema and the SSE bus in step 1):
 *   - heartbeat       : ignored, used by the server to keep the proxy
 *                       from idling the connection out
 *   - scrape.started  : a scrape begin — show queue activity
 *   - scrape.completed: invalidate /api/jobs so new rows appear
 *   - job.discovered  : also invalidate (could fire many times mid-scrape;
 *                       we let React Query's debouncing handle the flood)
 *
 * Application events (application.queued, .ready, etc.) and queue.progress
 * land in step 6/7. The handler shape is ready for them — just add cases.
 */
export function useSseInvalidator() {
  const qc = useQueryClient();

  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('scrape.completed', () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
    });
    es.addEventListener('job.discovered', () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
    });
    es.addEventListener('scrape.started', () => {
      // No cache invalidation needed — this is informational. A future
      // step adds a queue-status component that listens for this.
    });

    es.addEventListener('application.queued', () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
    });
    es.addEventListener('application.started', () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
    });
    es.addEventListener('application.ready', () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    });
    es.addEventListener('application.failed', () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
    });
    es.addEventListener('queue.drained', () => {
      qc.invalidateQueries({ queryKey: ['applications'] });
    });

    // The default 'message' event is what unnamed events come in as.
    // The step-2 bus formats events with `event: <name>` so we get
    // them on the named listeners above, not here. Left as a debug
    // safety net.
    es.onmessage = () => {
      // intentional no-op
    };

    es.onerror = () => {
      // EventSource auto-reconnects with backoff; nothing for us to
      // do here. If you want a UI banner during outages, this is the
      // hook for it — but that's polish, not core functionality.
    };

    return () => {
      es.close();
    };
  }, [qc]);
}
