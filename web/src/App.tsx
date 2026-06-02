import { Outlet, NavLink } from 'react-router-dom';
import { useSseInvalidator } from './lib/sse';

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
          <nav className="flex gap-4 text-sm">
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
            <span className="text-muted/40 cursor-not-allowed" title="Step 6">
              Applications
            </span>
            <span className="text-muted/40 cursor-not-allowed" title="Future">
              Sources
            </span>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
