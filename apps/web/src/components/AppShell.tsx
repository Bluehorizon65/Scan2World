import { LogOut } from 'lucide-react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLogout, useMe, useReady } from '../api/hooks';
import { Button, Notice, Spinner } from './ui';
import { Logo } from './Logo';

export function ServiceBanner() {
  const { data, error } = useReady();
  if (error) return <Notice tone="error" title="The API is not reachable">{error.message}</Notice>;
  if (!data) return null;
  const down = Object.entries(data.checks.services).filter(([, s]) => s === 'down').map(([n]) => n);
  if (data.status !== 'ready')
    return <Notice tone="error" title="Backend unavailable">The database or queue is down. Start the stack with docker compose up -d.</Notice>;
  if (down.length)
    return (
      <Notice tone="warning" title={`Processing service${down.length > 1 ? 's' : ''} offline: ${down.join(', ')}`}>
        Viewing projects still works; validation, reconstruction or processing will fail until the service is back.
      </Notice>
    );
  return null;
}

/** Signed-in layout. Unauthenticated visitors are sent to sign in and returned afterwards. */
export function AppShell() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();

  if (me.isPending) return <div className="p-8"><Spinner label="Loading your workspace" /></div>;
  if (me.error) return <div className="mx-auto max-w-xl p-8"><Notice tone="error" title="Could not load your account">{me.error.message}</Notice></div>;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-panel px-4 md:px-6">
        <Link to="/projects" className="flex items-center gap-2" aria-label="Scan2World Studio, projects">
          <Logo />
        </Link>
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="hidden sm:inline">{me.data.email}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/') })}
            aria-label="Sign out"
          >
            <LogOut className="size-4" aria-hidden /> <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>
      <div className="px-4 pt-3 empty:hidden md:px-6">
        <ServiceBanner />
      </div>
      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
