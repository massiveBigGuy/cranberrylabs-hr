import { useState, useEffect } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useSseInvalidator } from './lib/sse';
import { getPushState, subscribeToPush, unsubscribeFromPush, type PushState } from './lib/push';

export function App() {
  // Single SSE connection at the app root. Mounted here so the connection
  // persists across page navigations rather than being torn down and
  // reopened on every route change.
  useSseInvalidator();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-surface bg-surface/40 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
          <span className="font-semibold text-ink">cranberrylabs HR</span>
          <nav className="flex gap-4 text-sm flex-1">
            <NavLink
              to="/jobs"
              className={({ isActive }) =>
                `transition-colors ${
                  isActive ? 'text-ink' : 'text-muted hover:text-ink'
                }`
              }
            >
              Jobs
            </NavLink>
            <NavLink
              to="/resume"
              className={({ isActive }) =>
                `transition-colors ${
                  isActive ? 'text-ink' : 'text-muted hover:text-ink'
                }`
              }
            >
              Resume
            </NavLink>
            <NavLink
              to="/applications"
              className={({ isActive }) =>
                `transition-colors ${
                  isActive ? 'text-ink' : 'text-muted hover:text-ink'
                }`
              }
            >
              Applications
            </NavLink>
            <NavLink
              to="/sources"
              className={({ isActive }) =>
                `transition-colors ${
                  isActive ? 'text-ink' : 'text-muted hover:text-ink'
                }`
              }
            >
              Sources
            </NavLink>
            <NavLink
              to="/profiles"
              className={({ isActive }) =>
                `transition-colors ${
                  isActive ? 'text-ink' : 'text-muted hover:text-ink'
                }`
              }
            >
              Profiles
            </NavLink>
          </nav>
          <NotificationBell />
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

function NotificationBell() {
  const [state, setState] = useState<PushState>('unavailable');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPushState().then(setState);
  }, []);

  if (state === 'unavailable') return null;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (state === 'subscribed') {
        await unsubscribeFromPush();
        setState('unsubscribed');
      } else {
        const ok = await subscribeToPush();
        setState(ok ? 'subscribed' : 'unsubscribed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={state === 'subscribed' ? 'Notifications on — click to disable' : 'Enable push notifications'}
      className="text-muted hover:text-ink transition-colors disabled:opacity-50 ml-2"
      aria-label={state === 'subscribed' ? 'Disable push notifications' : 'Enable push notifications'}
    >
      {state === 'subscribed' ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M4.214 3.227a.75.75 0 0 0-1.156-.956 8.97 8.97 0 0 0-1.856 3.826.75.75 0 0 0 1.466.316 7.47 7.47 0 0 1 1.546-3.186ZM16.942 2.271a.75.75 0 0 0-1.157.956 7.47 7.47 0 0 1 1.547 3.186.75.75 0 0 0 1.466-.316 8.97 8.97 0 0 0-1.856-3.826Z" />
          <path fillRule="evenodd" d="M10 2a6 6 0 0 0-6 6c0 1.887-.454 3.665-1.257 5.234a.75.75 0 0 0 .515 1.076 32.91 32.91 0 0 0 3.256.508 3.5 3.5 0 0 0 6.972 0 32.903 32.903 0 0 0 3.256-.508.75.75 0 0 0 .515-1.076A11.448 11.448 0 0 1 16 8a6 6 0 0 0-6-6Zm0 14.5a2 2 0 0 1-1.95-1.557 33.54 33.54 0 0 0 3.9 0A2 2 0 0 1 10 16.5Z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
      )}
    </button>
  );
}
