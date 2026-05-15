import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { JobsPage } from './pages/JobsPage';
import './index.css';

/**
 * One QueryClient for the whole app. Defaults tuned for an admin
 * dashboard rather than a public-facing app:
 *   - staleTime: 30s — jobs change at scrape cadence (hourly+), not by
 *     the second; refetching on every focus is wasteful
 *   - refetchOnWindowFocus: false — we have SSE for that
 *   - retry: 1 — if the API is down we want to know fast, not after
 *     three retries
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<App />}>
            <Route index element={<Navigate to="/jobs" replace />} />
            <Route path="/jobs" element={<JobsPage />} />
            {/* /jobs/all, /sources, /resume, /settings land in later steps */}
            <Route path="*" element={<Navigate to="/jobs" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
