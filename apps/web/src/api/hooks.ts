import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError, post } from './client';
import type { Asset, DatasetValidation, Job, Page, Project, ProjectSettings, Ready, Upload, User } from './types';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
export const isTerminal = (j?: Pick<Job, 'status'> | null) => !!j && TERMINAL.has(j.status);

export const keys = {
  me: ['me'] as const,
  ready: ['ready'] as const,
  projects: (q: string, page: number) => ['projects', q, page] as const,
  project: (id: string) => ['project', id] as const,
  uploads: (id: string) => ['uploads', id] as const,
  jobs: (pid: string) => ['jobs', pid] as const,
  job: (id: string) => ['job', id] as const,
  assets: (pid: string) => ['assets', pid] as const,
};

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api<{ user: User }>('/auth/me').then((r) => r.user).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }),
    staleTime: 60_000,
  });
}

export function useReady() {
  return useQuery({ queryKey: keys.ready, queryFn: () => api<Ready>('/ready'), refetchInterval: 30_000, retry: false });
}

export function useAuth(mode: 'login' | 'register') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => post<{ user: User }>(`/auth/${mode}`, body),
    onSuccess: (r) => qc.setQueryData(keys.me, r.user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => post('/auth/logout'), onSuccess: () => qc.clear() });
}

export function useProjects(q: string, page: number) {
  return useQuery({
    queryKey: keys.projects(q, page),
    queryFn: () => api<Page<Project>>(`/projects?${new URLSearchParams({ q, page: String(page), pageSize: '20' })}`),
    placeholderData: (prev) => prev,
  });
}

export function useProject(id: string) {
  return useQuery({ queryKey: keys.project(id), queryFn: () => api<Project>(`/projects/${id}`) });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string }) => post<Project>('/projects', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; description?: string; settings?: ProjectSettings }) =>
      api<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (p) => qc.setQueryData(keys.project(id), p),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useUploads(projectId: string) {
  return useQuery({ queryKey: keys.uploads(projectId), queryFn: () => api<{ items: Upload[] }>(`/projects/${projectId}/uploads`).then((r) => r.items) });
}

export function useDeleteUpload(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uploadId: string) => api(`/projects/${projectId}/uploads/${uploadId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.uploads(projectId) });
      void qc.invalidateQueries({ queryKey: keys.project(projectId) });
    },
  });
}

export function useValidate(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ dataset: DatasetValidation }>(`/projects/${projectId}/validate`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.uploads(projectId) });
      void qc.invalidateQueries({ queryKey: keys.project(projectId) });
    },
  });
}

export function useJobs(projectId: string) {
  return useQuery({
    queryKey: keys.jobs(projectId),
    queryFn: () => api<{ items: Job[] }>(`/projects/${projectId}/jobs`).then((r) => r.items),
    refetchInterval: (q) => (q.state.data?.some((j) => !isTerminal(j)) ? 5000 : false),
  });
}

/** Live job: SSE for immediacy, polling as fallback when the stream can't connect. */
export function useJob(jobId: string | undefined) {
  const qc = useQueryClient();
  const [streaming, setStreaming] = useState(false);
  const query = useQuery({
    queryKey: keys.job(jobId ?? ''),
    queryFn: () => api<Job>(`/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (isTerminal(q.state.data) ? false : streaming ? 15_000 : 2_000),
  });
  const done = isTerminal(query.data);

  useEffect(() => {
    if (!jobId || done || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/v1/jobs/${jobId}/events`, { withCredentials: true });
    es.onopen = () => setStreaming(true);
    es.onmessage = (e: MessageEvent<string>) => {
      const job = JSON.parse(e.data) as Job;
      const prev = qc.getQueryData<Job>(keys.job(jobId));
      qc.setQueryData<Job>(keys.job(jobId), { ...prev, ...job, events: prev?.events });
      // Stream messages carry no event list; refetch on stage change so per-stage timings stay accurate.
      if (prev && prev.stage !== job.stage) void qc.invalidateQueries({ queryKey: keys.job(jobId) });
      if (isTerminal(job)) {
        es.close();
        setStreaming(false);
        void qc.invalidateQueries({ queryKey: keys.job(jobId) }); // pick up the final event list
        void qc.invalidateQueries({ queryKey: keys.assets(job.projectId) });
        void qc.invalidateQueries({ queryKey: keys.jobs(job.projectId) });
        void qc.invalidateQueries({ queryKey: keys.project(job.projectId) });
      }
    };
    es.onerror = () => {
      es.close();
      setStreaming(false);
    };
    return () => es.close();
  }, [jobId, done, qc]);

  return query;
}

export function useJobAction(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => post<Job>(path, body),
    onSuccess: (job) => {
      qc.setQueryData(keys.job(job.id), job);
      void qc.invalidateQueries({ queryKey: keys.jobs(projectId) });
      void qc.invalidateQueries({ queryKey: keys.project(projectId) });
    },
  });
}

export function useAssets(projectId: string) {
  return useQuery({ queryKey: keys.assets(projectId), queryFn: () => api<{ items: Asset[] }>(`/projects/${projectId}/assets`).then((r) => r.items) });
}
