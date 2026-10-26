import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Box, Check, Download, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, assetUrl, thumbnailUrl } from '../../api/client';
import { isTerminal, useAssets, useDeleteProject, useDeleteUpload, useJob, useJobAction, useJobs, useProject, useUploads, useValidate } from '../../api/hooks';
import type { Asset, Job, Project, Upload } from '../../api/types';
import { Button, ConfirmDialog, Notice, Panel, Spinner, StatusBadge } from '../../components/ui';
import { ASSET_LABEL, formatBytes, formatNumber, formatRelative } from '../../lib/format';
import { JobTimeline } from '../jobs/JobTimeline';
import { UploadDropzone } from './UploadDropzone';

interface Limits {
  maxImages: number;
  maxFileBytes: number;
  minImages: number;
}
const useLimits = () => useQuery({ queryKey: ['config'], queryFn: () => api<Limits>('/config'), staleTime: Infinity });

const ISSUE_LABEL: Record<string, string> = {
  blurry: 'Blurry', too_dark: 'Too dark', overexposed: 'Overexposed', low_contrast: 'Low contrast',
  few_features: 'Little detail', low_resolution: 'Low resolution', unreadable: 'Unreadable',
};

type StepState = 'done' | 'current' | 'todo';

function Rail({ steps }: { steps: { id: string; label: string; state: StepState }[] }) {
  return (
    <nav aria-label="Project steps" className="lg:sticky lg:top-6">
      <ol className="flex gap-1 overflow-x-auto lg:grid lg:gap-0">
        {steps.map((s, i) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={s.state === 'current' ? 'step' : undefined}
              className={clsx('flex items-center gap-3 whitespace-nowrap rounded-[var(--radius-control)] px-3 py-2 text-sm', s.state === 'current' ? 'bg-raised text-ink' : 'text-muted hover:text-ink')}
            >
              <span className={clsx('grid size-6 place-items-center rounded-full border text-xs', s.state === 'done' ? 'border-walkable/50 text-walkable' : s.state === 'current' ? 'border-brass text-brass' : 'border-line text-faint')}>
                {s.state === 'done' ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              {s.label}
              <span className="sr-only">{s.state === 'done' ? '(done)' : s.state === 'current' ? '(next)' : ''}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Thumb({ projectId, upload, flagged, onDelete }: { projectId: string; upload: Upload; flagged: boolean; onDelete: () => void }) {
  const issues = upload.metadata.quality?.issues ?? [];
  return (
    <li className="group relative overflow-hidden rounded-[var(--radius-control)] border border-line bg-canvas">
      <img src={thumbnailUrl(projectId, upload.id)} alt={upload.fileName} loading="lazy" decoding="async" width={160} height={120} className="aspect-[4/3] w-full object-cover" />
      <div className="flex items-center justify-between gap-1 px-2 py-1">
        <span className="truncate text-xs text-muted" title={upload.fileName}>{upload.fileName}</span>
        <button type="button" onClick={onDelete} aria-label={`Remove ${upload.fileName}`} className="grid size-6 shrink-0 place-items-center rounded text-faint hover:text-danger">
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {(issues.length > 0 || flagged) && (
        <ul className="absolute left-1 top-1 flex flex-wrap gap-1">
          {issues.map((i) => <li key={i} className="rounded bg-canvas/90 px-1.5 py-0.5 text-[11px] text-warning">{ISSUE_LABEL[i] ?? i}</li>)}
          {flagged && <li className="rounded bg-canvas/90 px-1.5 py-0.5 text-[11px] text-warning">Near-duplicate</li>}
        </ul>
      )}
    </li>
  );
}

function PhotosSection({ project, limits }: { project: Project; limits?: Limits }) {
  const uploads = useUploads(project.id);
  const validate = useValidate(project.id);
  const remove = useDeleteUpload(project.id);
  const v = project.validation;
  const dupIds = new Set((v?.duplicateGroups ?? []).flatMap((g) => g.slice(1)));
  const stale = v && uploads.data && new Date(v.validatedAt) < new Date(Math.max(...uploads.data.map((u) => new Date(u.createdAt).getTime())));

  return (
    <Panel title={<h2 id="photos" className="font-heading scroll-mt-6 text-base">Photos</h2>} actions={uploads.data?.length ? <span className="text-sm text-muted">{uploads.data.length} uploaded</span> : null}>
      <div className="grid gap-5">
        <UploadDropzone projectId={project.id} maxFileBytes={limits?.maxFileBytes ?? 40 * 1024 * 1024} maxImages={limits?.maxImages} />
        {uploads.isPending ? <Spinner label="Loading photos" /> : uploads.data && uploads.data.length > 0 && (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {[...uploads.data].sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true })).map((u) => <Thumb key={u.id} projectId={project.id} upload={u} flagged={dupIds.has(u.id)} onDelete={() => remove.mutate(u.id)} />)}
          </ul>
        )}

        <div id="check" className="grid scroll-mt-6 gap-3 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-heading">Check photo quality</h3>
              <p className="text-sm text-muted">Scores blur, exposure and detail, and finds near-duplicates. Overlap is only confirmed during reconstruction.</p>
            </div>
            <Button onClick={() => validate.mutate()} loading={validate.isPending} disabled={!uploads.data?.length}>{v ? 'Check again' : 'Check photos'}</Button>
          </div>
          {validate.error && <Notice tone="error">{validate.error.message}</Notice>}
          {v && (
            <div className="grid gap-3 rounded-[var(--radius-panel)] bg-canvas p-4">
              <p className="text-sm">
                <span className={clsx('font-medium', v.rating === 'good' ? 'text-walkable' : v.rating === 'fair' ? 'text-warning' : 'text-danger')}>
                  {v.rating === 'good' ? 'Good capture' : v.rating === 'fair' ? 'Usable, with issues' : 'Likely to fail'}
                </span>
                <span className="text-muted"> · {v.usable} of {v.count} photos usable · checked {formatRelative(v.validatedAt)}</span>
              </p>
              {stale && <p className="text-sm text-warning">Photos were added after this check. Run it again for an up-to-date result.</p>}
              {v.recommendations.length > 0 && <ul className="grid list-disc gap-1 pl-5 text-sm text-muted">{v.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>}
              {v.notes.map((n) => <p key={n} className="text-xs text-faint">{n}</p>)}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

const QUALITY = [
  { value: 'draft', label: 'Draft', body: 'Fastest. Smaller images; good for checking a capture.' },
  { value: 'balanced', label: 'Balanced', body: 'Recommended for most rooms.' },
  { value: 'high', label: 'High', body: 'Full-resolution features; slowest.' },
] as const;

function ReconstructSection({ project, jobs, limits }: { project: Project; jobs: Job[]; limits?: Limits }) {
  const latest = jobs.find((j) => j.kind === 'reconstruction');
  const live = useJob(latest?.id);
  const action = useJobAction(project.id);
  const [quality, setQuality] = useState<'draft' | 'balanced' | 'high'>('balanced');
  const [matcher, setMatcher] = useState<'exhaustive' | 'sequential'>('exhaustive');
  const job = live.data ?? latest;
  const running = job && !isTerminal(job);
  const enough = project._count.uploads >= (limits?.minImages ?? 3);
  const history = jobs.filter((j) => j.kind === 'reconstruction' && j.id !== job?.id);

  return (
    <Panel title={<h2 id="reconstruct" className="font-heading scroll-mt-6 text-base">Reconstruction</h2>}>
      <div className="grid gap-6">
        {!running && (
          <div className="grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Quality</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {QUALITY.map((q) => (
                  <label key={q.value} className={clsx('cursor-pointer rounded-[var(--radius-control)] border p-3 text-sm', quality === q.value ? 'border-brass bg-brass/5' : 'border-line hover:border-faint')}>
                    <input type="radio" name="quality" value={q.value} checked={quality === q.value} onChange={() => setQuality(q.value)} className="sr-only" />
                    <span className="block font-medium">{q.label}</span>
                    <span className="block text-muted">{q.body}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 accent-[var(--color-brass)]" checked={matcher === 'sequential'} onChange={(e) => setMatcher(e.target.checked ? 'sequential' : 'exhaustive')} />
              <span><span className="font-medium">Photos are in capture order</span><span className="block text-muted">Faster matching for long, ordered sequences such as video frames. Leave off if unsure.</span></span>
            </label>
            {action.error && <Notice tone="error">{action.error.message}</Notice>}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={!enough} loading={action.isPending} onClick={() => action.mutate({ path: `/projects/${project.id}/jobs/reconstruction`, body: { quality, matcher } })}>
                {job ? 'Reconstruct again' : 'Start reconstruction'}
              </Button>
              {!enough && <span className="text-sm text-muted">Add at least {limits?.minImages ?? 3} photos first.</span>}
              <span className="text-sm text-muted">Dense reconstruction runs automatically when the server has an NVIDIA GPU.</span>
            </div>
          </div>
        )}
        {job && (
          <div className="grid gap-3 border-t border-line pt-5 first:border-0 first:pt-0">
            <h3 className="font-heading">{running ? 'In progress' : 'Latest run'}</h3>
            <JobTimeline
              job={job}
              busy={action.isPending}
              onCancel={() => action.mutate({ path: `/jobs/${job.id}/cancel` })}
              onRetry={() => action.mutate({ path: `/jobs/${job.id}/retry` })}
            />
            {job.status === 'completed' && job.diagnostics?.stats && (
              <p className="text-sm text-muted">
                {formatNumber(job.diagnostics.stats.registered_images)} of {formatNumber(job.diagnostics.stats.total_images)} photos placed ·{' '}
                {formatNumber(job.diagnostics.stats.points3d)} points · {job.diagnostics.dense ? 'dense' : 'sparse only (no GPU)'}
              </p>
            )}
          </div>
        )}
        {history.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Earlier runs ({history.length})</summary>
            <ul className="mt-2 grid gap-1">
              {history.map((h) => (
                <li key={h.id} className="flex items-center gap-3"><StatusBadge status={h.status} /><span className="text-muted">{formatRelative(h.createdAt)}</span>{h.errorMessage && <span className="truncate text-faint">{h.errorMessage}</span>}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Panel>
  );
}

function AssetList({ assets, projectId }: { assets: Asset[]; projectId: string }) {
  return (
    <ul className="grid gap-1">
      {assets.map((a) => (
        <li key={a.id} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[var(--radius-control)] bg-canvas px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm">{a.name}</p>
            <p className="text-xs text-muted">
              {ASSET_LABEL[a.assetType]} · {a.format.toUpperCase()} · {formatBytes(a.sizeBytes)}
              {a.metadata.triangles ? ` · ${formatNumber(a.metadata.triangles)} triangles` : a.metadata.points ? ` · ${formatNumber(a.metadata.points)} points` : ''}
            </p>
          </div>
          <div className="flex gap-1">
            {a.assetType !== 'export_package' && a.assetType !== 'report' && (
              <Link to={`/projects/${projectId}/studio?asset=${a.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-sm text-muted hover:bg-raised hover:text-ink">
                <Box className="size-4" aria-hidden /> View
              </Link>
            )}
            <a href={assetUrl(a.id)} download aria-label={`Download ${a.name}`} className="inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-muted hover:bg-raised hover:text-ink">
              <Download className="size-4" aria-hidden />
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

function NextStep({ id, title, body, to, cta, disabled }: { id: string; title: string; body: string; to: string; cta: string; disabled?: boolean }) {
  return (
    <div id={id} className="flex scroll-mt-6 flex-wrap items-center justify-between gap-4">
      <div>
        <h3 className="font-heading">{title}</h3>
        <p className="max-w-[60ch] text-sm text-muted">{body}</p>
      </div>
      {disabled ? <Button disabled>{cta}</Button> : <Link to={to} className="inline-flex h-10 items-center rounded-[var(--radius-control)] border border-line bg-raised px-4 hover:border-faint">{cta}</Link>}
    </div>
  );
}

export function ProjectPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const jobs = useJobs(projectId);
  const assets = useAssets(projectId);
  const limits = useLimits();
  const del = useDeleteProject();

  if (project.isPending) return <div className="p-6"><Spinner label="Loading project" /></div>;
  if (project.error) return <div className="mx-auto max-w-xl p-6"><Notice tone="error" title="Could not open this project">{project.error.message}</Notice></div>;

  const p = project.data;
  const all = assets.data ?? [];
  const has = (t: string) => all.some((a) => a.assetType === t);
  const hasMesh = has('mesh_visual');
  const steps: { id: string; label: string; done: boolean }[] = [
    { id: 'photos', label: 'Add photos', done: p._count.uploads >= (limits.data?.minImages ?? 3) },
    { id: 'check', label: 'Check quality', done: !!p.validation },
    { id: 'reconstruct', label: 'Reconstruct', done: hasMesh },
    { id: 'results', label: 'Inspect in 3D', done: hasMesh && all.some((a) => a.metadata.aligned) },
    { id: 'prepare', label: 'Prepare game map', done: has('mesh_collision') },
    { id: 'export', label: 'Export', done: has('export_package') },
  ];
  const firstTodo = steps.findIndex((s) => !s.done);
  const rail = steps.map((s, i) => ({ ...s, state: (s.done ? 'done' : i === firstTodo ? 'current' : 'todo') as StepState }));

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/projects" className="text-sm text-muted hover:text-ink">Projects</Link>
          <h1 className="font-heading mt-1 truncate text-2xl">{p.name}</h1>
          {p.description && <p className="mt-1 max-w-[70ch] text-sm text-muted">{p.description}</p>}
        </div>
        <ConfirmDialog
          trigger={<Button variant="ghost" size="sm"><Trash2 className="size-4" aria-hidden /> Delete project</Button>}
          title={`Delete “${p.name}”?`}
          description="This permanently removes its photos, reconstructions and exports. It cannot be undone."
          confirmLabel="Delete project"
          busy={del.isPending}
          onConfirm={() => del.mutate(p.id, { onSuccess: () => navigate('/projects') })}
        />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[220px_1fr]">
        <Rail steps={rail} />
        <div className="grid min-w-0 gap-6">
          <PhotosSection project={p} limits={limits.data} />
          {jobs.data ? <ReconstructSection project={p} jobs={jobs.data} limits={limits.data} /> : <Spinner label="Loading jobs" />}
          <Panel title={<h2 id="results" className="font-heading scroll-mt-6 text-base">Results</h2>} actions={hasMesh ? <Link to={`/projects/${p.id}/studio`} className="text-sm text-brass hover:underline">Open the 3D studio</Link> : null}>
            <div className="grid gap-6">
              {all.length ? <AssetList assets={all.filter((a) => a.assetType !== 'report')} projectId={p.id} /> : <p className="text-sm text-muted">Reconstructed point clouds and meshes will appear here.</p>}
              <div className="grid gap-5 border-t border-line pt-5">
                <NextStep id="prepare" title="Prepare as a game map" body="Level the floor, set real scale, simplify, and generate collision and walkable surfaces." to={`/projects/${p.id}/prepare`} cta="Prepare game map" disabled={!hasMesh} />
                <NextStep id="export" title="Export" body="Package GLB, OBJ or PLY files with a manifest for Unity, Unreal or Blender." to={`/projects/${p.id}/export`} cta="Export files" disabled={!hasMesh} />
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
