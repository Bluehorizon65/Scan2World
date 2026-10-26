import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { ApiError } from './api/client';
import { AppShell } from './components/AppShell';
import { AuthPage } from './features/auth/AuthPage';
import { ExportPage } from './features/export/ExportPage';
import { GamemapPage } from './features/gamemap/GamemapPage';
import { Landing } from './features/landing/Landing';
import { ProjectPage } from './features/projects/ProjectPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { StudioPage } from './features/studio/StudioPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
  },
});

function NotFound() {
  return (
    <main className="mx-auto grid max-w-xl gap-3 p-10">
      <h1 className="font-heading text-2xl">This page does not exist</h1>
      <Link to="/" className="text-brass hover:underline">Go to the start page</Link>
    </main>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route element={<AppShell />}>
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<ProjectPage />} />
            <Route path="/projects/:projectId/studio" element={<StudioPage />} />
            <Route path="/projects/:projectId/prepare" element={<GamemapPage />} />
            <Route path="/projects/:projectId/export" element={<ExportPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
