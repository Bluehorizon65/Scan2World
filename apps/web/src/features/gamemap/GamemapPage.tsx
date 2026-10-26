import * as Slider from '@radix-ui/react-slider';
import * as Switch from '@radix-ui/react-switch';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { isTerminal, useAssets, useJob, useJobAction, useJobs, useProject, useUpdateProject } from '../../api/hooks';
import type { Asset, Job } from '../../api/types';
import { Button, Input, Notice, Spinner } from '../../components/ui';
import { formatNumber } from '../../lib/format';
import { JobTimeline } from '../jobs/JobTimeline';
import { useStudio } from '../studio/store';
import { unitsOf } from '../studio/layers';
import { StatusBar, Toolbar } from '../studio/StudioPage';
import { Viewport } from '../studio/Viewport';

function Toggle({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-muted">{hint}</span>}
      </label>
      <Switch.Root id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-raised data-[state=checked]:bg-brass disabled:opacity-40">
        <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-ink transition-transform data-[state=checked]:translate-x-[18px]" />
      </Switch.Root>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line p-4 last:border-0">
      <h2 className="font-heading text-base">{title}</h2>
      {children}
    </section>
  );
}

const AXES = ['X (width)', 'Y (height)', 'Z (depth)'];

function ProcessForm({ source, projectId, onJob }: { source: Asset; projectId: string; onJob: (j: Job) => void }) {
  const action = useJobAction(projectId);
  const updateProject = useUpdateProject(projectId);
  const dims = source.metadata.dimensions;
  const [clean, setClean] = useState(true);
  const [level, setLevel] = useState(!source.metadata.aligned);
  const [reduce, setReduce] = useState(false);
  const [target, setTarget] = useState(Math.min(200_000, Math.round((source.metadata.triangles ?? 100_000) / 2)));
  const [axis, setAxis] = useState(0);
  const [real, setReal] = useState('');
  const realM = Number(real);
  const factor = dims && realM > 0 ? realM / dims[axis] : null;
  const ops = [
    ...(clean ? [{ op: 'remove_small_components', minFaceRatio: 0.01 }] : []),
    ...(level ? [{ op: 'align_floor' }] : []),
    ...(factor ? [{ op: 'scale', factor }] : []),
    ...(reduce ? [{ op: 'simplify', targetTriangles: target }] : []),
  ];

  return (
    <div className="grid gap-4">
      <Toggle id="clean" label="Remove loose fragments" hint="Drops disconnected pieces smaller than 1% of the main surface." checked={clean} onChange={setClean} />
      <Toggle id="level" label="Level the floor" hint={source.metadata.aligned ? 'Already floor-aligned.' : 'Rotates so the floor is flat at height 0 and walls line up with X and Z.'} checked={level} onChange={setLevel} disabled={source.metadata.aligned} />
      <Toggle id="reduce" label="Reduce triangles" checked={reduce} onChange={setReduce} />
      {reduce && (
        <label className="grid gap-1 text-sm">
          Target triangles <span className="text-muted">(currently {formatNumber(source.metadata.triangles)})</span>
          <Input type="number" min={100} step={1000} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
        </label>
      )}
      {!source.metadata.scaled && dims && (
        <fieldset className="grid gap-2 text-sm">
          <legend className="mb-1 font-medium">Real-world scale</legend>
          <p className="text-muted">Pick a dimension you know, such as the room's width, and enter its real length.</p>
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <select aria-label="Dimension" value={axis} onChange={(e) => setAxis(Number(e.target.value))} className="h-10 rounded-[var(--radius-control)] border border-line bg-canvas px-2">
              {AXES.map((a, i) => <option key={a} value={i}>{a}: {dims[i].toFixed(2)} units</option>)}
            </select>
            <Input aria-label="Real length in metres" type="number" min={0} step={0.01} placeholder="metres" value={real} onChange={(e) => setReal(e.target.value)} />
          </div>
          {factor && <p className="text-muted">Scale ×{factor.toFixed(4)} — the model becomes {dims.map((d) => (d * factor).toFixed(2)).join(' × ')} m.</p>}
          {level && factor && <p className="text-xs text-faint">Dimensions are measured before levelling; levelling can change which axis is which. For accuracy, level first and set scale on the result.</p>}
        </fieldset>
      )}
      {action.error && <Notice tone="error">{action.error.message}</Notice>}
      <Button
        variant="primary"
        disabled={!ops.length}
        loading={action.isPending}
        onClick={() =>
          action.mutate(
            { path: `/assets/${source.id}/process`, body: { ops } },
            { onSuccess: (j) => { onJob(j); if (factor) updateProject.mutate({ settings: { scaleFactor: factor, units: 'm' } }); } },
          )
        }
      >
        Process mesh
      </Button>
      <p className="text-xs text-faint">Creates a new mesh; the original stays untouched.</p>
    </div>
  );
}

function GamemapForm({ source, projectId, onJob }: { source: Asset; projectId: string; onJob: (j: Job) => void }) {
  const action = useJobAction(projectId);
  const [budget, setBudget] = useState(5000);
  const [slope, setSlope] = useState(35);
  return (
    <div className="grid gap-4">
      <label className="grid gap-1 text-sm">
        Collision triangle budget
        <Input type="number" min={100} max={500000} step={500} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
      </label>
      <div className="grid gap-2 text-sm">
        <span id="slope-label">Steepest walkable slope: {slope}°</span>
        <Slider.Root aria-labelledby="slope-label" min={5} max={60} step={1} value={[slope]} onValueChange={([v]) => setSlope(v)} className="relative flex h-5 touch-none items-center">
          <Slider.Track className="relative h-1 flex-1 rounded-full bg-raised"><Slider.Range className="absolute h-full rounded-full bg-brass" /></Slider.Track>
          <Slider.Thumb aria-label="Steepest walkable slope" className="block size-4 rounded-full border-2 border-brass bg-canvas" />
        </Slider.Root>
      </div>
      {!source.metadata.aligned && <Notice tone="info">The floor will be levelled automatically before collision and walkable surfaces are generated.</Notice>}
      {action.error && <Notice tone="error">{action.error.message}</Notice>}
      <Button variant="primary" loading={action.isPending} onClick={() => action.mutate({ path: `/assets/${source.id}/gamemap`, body: { collisionTargetTriangles: budget, maxSlopeDeg: slope } }, { onSuccess: onJob })}>
        Generate game-map assets
      </Button>
    </div>
  );
}

function Report({ job, units }: { job: Job; units: string }) {
  const r = job.resultManifest?.report;
  if (!r) return null;
  return (
    <div className="grid gap-3 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="text-xs text-muted">Visual mesh</dt><dd>{formatNumber(r.visual?.triangles)} triangles</dd></div>
        <div><dt className="text-xs text-muted">Collision mesh</dt><dd>{formatNumber(r.collision?.triangles)} triangles{r.collision?.valid ? '' : ' (check bounds)'}</dd></div>
        <div><dt className="text-xs text-muted">Walkable area</dt><dd>{r.walkable.areaUnits2.toFixed(2)} {units === 'm' ? 'm²' : 'units²'} · {(r.walkable.coverage * 100).toFixed(0)}% of footprint</dd></div>
        <div><dt className="text-xs text-muted">Walkable confidence</dt><dd className="capitalize">{r.walkable?.confidence}</dd></div>
      </dl>
      {r.alignment && <p className="text-muted">Floor levelled with {r.alignment.confidence} confidence ({r.alignment.method === 'cameras' ? 'camera orientation' : 'geometry'}).</p>}
      <Notice tone="info" title="No navigation mesh">{r.navigation?.note}</Notice>
      {r.warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
    </div>
  );
}

export function GamemapPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const assets = useAssets(projectId);
  const jobs = useJobs(projectId);
  const { showOnly, setVisible, visible } = useStudio();
  const meshes = useMemo(() => (assets.data ?? []).filter((a) => a.assetType === 'mesh_visual'), [assets.data]);
  const [sourceId, setSourceId] = useState<string>();
  const [jobId, setJobId] = useState<string>();
  const source = meshes.find((m) => m.id === sourceId) ?? meshes.find((m) => !m.metadata.gamemap) ?? meshes[0];
  const latestGeometryJob = (jobs.data ?? []).find((j) => (j.kind === 'processing' || j.kind === 'gamemap') && j.sourceAssetId === source?.id);
  const job = useJob(jobId ?? latestGeometryJob?.id).data;

  // Game-map outputs derived from the selected source.
  const gm = useMemo(() => {
    const visual = (assets.data ?? []).filter((a) => a.parentAssetId === source?.id && a.metadata.gamemap)[0];
    const children = (assets.data ?? []).filter((a) => visual && a.parentAssetId === visual.id);
    return { visual, collision: children.find((c) => c.assetType === 'mesh_collision'), walkable: children.find((c) => c.assetType === 'walkable') };
  }, [assets.data, source?.id]);

  useEffect(() => {
    if (!source) return;
    showOnly([gm.visual?.id ?? source.id, gm.collision?.id, gm.walkable?.id].filter(Boolean) as string[]);
  }, [source, gm.visual?.id, gm.collision?.id, gm.walkable?.id, showOnly]);

  // When a job finishes, select its new mesh as the working source (processing) to continue the flow.
  useEffect(() => {
    if (job?.status === 'completed' && job.kind === 'processing' && job.resultManifest?.assets?.[0]?.id && jobId) {
      setSourceId(job.resultManifest.assets[0].id);
      setJobId(undefined);
    }
  }, [job?.status, job?.kind, job?.resultManifest, jobId]);

  useEffect(() => () => showOnly([]), [showOnly]);

  if (project.isPending || assets.isPending) return <div className="p-6"><Spinner label="Loading" /></div>;
  if (project.error || assets.error) return <div className="p-6"><Notice tone="error">{(project.error ?? assets.error)!.message}</Notice></div>;
  if (!source)
    return (
      <div className="mx-auto max-w-xl p-8">
        <Notice title="Nothing to prepare yet">Run a reconstruction first; its mesh becomes the starting point here.</Notice>
        <Link to={`/projects/${projectId}`} className="mt-4 inline-block text-brass hover:underline">Back to the project</Link>
      </div>
    );

  const layers = (assets.data ?? []).filter((a) => visible[a.id]);
  const parent = meshes.find((m) => m.id === source.parentAssetId);
  const live = job && !isTerminal(job);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto] md:h-[calc(100dvh-3.5rem)] md:flex-none md:grid-cols-[minmax(0,1fr)_360px] md:grid-rows-[minmax(0,1fr)_auto]">
      <section aria-label="Viewport" className="relative min-h-[50vh] overflow-hidden">
        {layers.length > 0 && <Viewport layers={layers} units={unitsOf(source)} />}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap justify-between gap-2">
          <Link to={`/projects/${projectId}`} className="pointer-events-auto inline-flex h-10 items-center gap-1 rounded-[var(--radius-panel)] border border-line bg-panel/95 px-3 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> {project.data.name}
          </Link>
          <div className="pointer-events-auto"><Toolbar /></div>
        </div>
        {(gm.collision || gm.walkable) && (
          <div className="absolute bottom-3 left-3 grid gap-1 rounded-[var(--radius-panel)] border border-line bg-panel/95 p-3 text-sm">
            <p className="text-xs text-muted">Overlays</p>
            {[{ a: gm.collision, label: 'Collision', color: 'bg-collision' }, { a: gm.walkable, label: 'Walkable', color: 'bg-walkable' }].map(({ a, label, color }) => a && (
              <label key={a.id} className="flex items-center gap-2">
                <input type="checkbox" checked={!!visible[a.id]} onChange={(e) => setVisible(a.id, e.target.checked)} className="accent-[var(--color-brass)]" />
                <span className={`size-2.5 rounded-sm ${color}`} aria-hidden /> {label}
              </label>
            ))}
          </div>
        )}
      </section>

      <aside aria-label="Game-map preparation" className="border-l border-line bg-panel md:row-span-1 md:overflow-auto">
        <Section title="Source mesh">
          <select aria-label="Source mesh" value={source.id} onChange={(e) => { setSourceId(e.target.value); setJobId(undefined); }} className="h-10 rounded-[var(--radius-control)] border border-line bg-canvas px-2 text-sm">
            {meshes.filter((m) => !m.metadata.gamemap).map((m) => (
              <option key={m.id} value={m.id}>{m.name} · {formatNumber(m.metadata.triangles)} tris{m.metadata.aligned ? ' · levelled' : ''}{m.metadata.scaled ? ' · scaled' : ''}</option>
            ))}
          </select>
          {parent && (
            <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-control)] bg-canvas p-3 text-sm">
              <div><p className="text-xs text-muted">Original</p><p>{formatNumber(parent.metadata.triangles)} tris</p><p className="text-xs text-muted">{parent.metadata.dimensions?.map((d) => d.toFixed(2)).join(' × ')}</p></div>
              <div><p className="text-xs text-muted">This version</p><p>{formatNumber(source.metadata.triangles)} tris</p><p className="text-xs text-muted">{source.metadata.dimensions?.map((d) => d.toFixed(2)).join(' × ')} {unitsOf(source)}</p></div>
              <button type="button" className="col-span-2 justify-self-start text-xs text-brass hover:underline" onClick={() => showOnly([parent.id])}>Show original in the viewport</button>
            </div>
          )}
        </Section>
        {live && job ? (
          <Section title={job.kind === 'processing' ? 'Processing' : 'Generating game-map assets'}>
            <JobTimeline job={job} />
          </Section>
        ) : (
          <>
            <Section title="Clean, level and scale"><ProcessForm key={source.id} source={source} projectId={projectId} onJob={(j) => setJobId(j.id)} /></Section>
            <Section title="Collision and walkable surfaces"><GamemapForm source={source} projectId={projectId} onJob={(j) => setJobId(j.id)} /></Section>
          </>
        )}
        {job?.status === 'failed' && <Section title="Last run failed"><JobTimeline job={job} /></Section>}
        {job?.status === 'completed' && job.kind === 'gamemap' && (
          <Section title="Game-map report">
            <Report job={job} units={unitsOf(source)} />
            <Link to={`/projects/${projectId}/export?asset=${gm.visual?.id ?? ''}`} className="inline-flex h-10 items-center justify-center rounded-[var(--radius-control)] bg-brass px-4 font-semibold text-canvas hover:bg-brass-strong">Export these assets</Link>
          </Section>
        )}
      </aside>
      <div className="md:col-span-2"><StatusBar units={unitsOf(source)} /></div>
    </div>
  );
}
