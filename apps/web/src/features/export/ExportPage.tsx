import { CheckCircle2, CircleX, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import { isTerminal, useAssets, useJob, useJobAction, useJobs, useProject } from '../../api/hooks';
import type { Asset } from '../../api/types';
import { Button, Notice, Panel, Spinner } from '../../components/ui';
import { formatBytes, formatNumber, formatRelative } from '../../lib/format';
import { JobTimeline } from '../jobs/JobTimeline';

const FORMATS = [
  { id: 'glb', label: 'GLB', body: 'Single binary glTF. Opens in browsers, Blender, Unreal (Interchange) and Unity with a glTF importer.' },
  { id: 'obj', label: 'OBJ', body: 'Widely supported mesh format; imports natively in Unity and Blender.' },
  { id: 'ply', label: 'PLY', body: 'Mesh with vertex colours, common in scanning and point-cloud tools.' },
] as const;

function Package({ asset }: { asset: Asset }) {
  const m = asset.metadata.manifest;
  if (!m) return null;
  const allOk = m.files.every((f) => f.validation === 'ok');
  return (
    <article className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-canvas p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-heading">{asset.name}</h3>
          <p className="text-xs text-muted">{formatBytes(asset.sizeBytes)} zip · {formatRelative(asset.createdAt)} · units: {m.coordinateSystem.units === 'm' ? 'metres' : 'reconstruction units'} · up axis {m.coordinateSystem.upAxis}</p>
        </div>
        <a href={assetUrl(asset.id)} download className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] bg-brass px-3 text-sm font-semibold text-canvas hover:bg-brass-strong">
          <Download className="size-4" aria-hidden /> Download package
        </a>
      </header>
      <p className={allOk ? 'flex items-center gap-2 text-sm text-walkable' : 'flex items-center gap-2 text-sm text-danger'}>
        {allOk ? <CheckCircle2 className="size-4" aria-hidden /> : <CircleX className="size-4" aria-hidden />}
        {allOk ? 'Every file was re-read after export and matches the source geometry.' : 'Some files failed validation; do not use them.'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="text-muted"><tr><th className="py-1.5 pr-4 font-medium">File</th><th className="py-1.5 pr-4 font-medium">Role</th><th className="py-1.5 pr-4 font-medium">Triangles</th><th className="py-1.5 pr-4 font-medium">Size</th><th className="py-1.5 font-medium">Check</th></tr></thead>
          <tbody>
            {m.files.map((f) => (
              <tr key={f.path} className="border-t border-line">
                <td className="py-1.5 pr-4">{f.path}</td>
                <td className="py-1.5 pr-4 capitalize text-muted">{f.role}</td>
                <td className="py-1.5 pr-4">{formatNumber(f.triangles)}</td>
                <td className="py-1.5 pr-4">{formatBytes(f.sizeBytes)}</td>
                <td className="py-1.5">{f.validation === 'ok' ? 'Valid' : 'Failed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Engine notes</summary>
        <ul className="mt-2 grid list-disc gap-1 pl-5 text-muted">{m.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </details>
    </article>
  );
}

export function ExportPage() {
  const { projectId = '' } = useParams();
  const [params] = useSearchParams();
  const project = useProject(projectId);
  const assets = useAssets(projectId);
  const jobs = useJobs(projectId);
  const action = useJobAction(projectId);
  const all = useMemo(() => assets.data ?? [], [assets.data]);
  const meshes = all.filter((a) => a.assetType === 'mesh_visual');
  const preferred = params.get('asset') || meshes.find((m) => m.metadata.gamemap)?.id || meshes[0]?.id;
  const [sourceId, setSourceId] = useState<string>();
  const source = meshes.find((m) => m.id === (sourceId ?? preferred));
  const [formats, setFormats] = useState<string[]>(['glb', 'obj']);
  const [withCollision, setWithCollision] = useState(true);
  const [withWalkable, setWithWalkable] = useState(true);
  const children = all.filter((a) => a.parentAssetId === source?.id);
  const hasCollision = children.some((c) => c.assetType === 'mesh_collision');
  const hasWalkable = children.some((c) => c.assetType === 'walkable');
  const latest = (jobs.data ?? []).find((j) => j.kind === 'export');
  const job = useJob(latest?.id).data;
  const packages = all.filter((a) => a.assetType === 'export_package');

  if (project.isPending || assets.isPending) return <div className="p-6"><Spinner label="Loading" /></div>;
  if (project.error || assets.error) return <div className="p-6"><Notice tone="error">{(project.error ?? assets.error)!.message}</Notice></div>;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 md:px-8">
      <div>
        <Link to={`/projects/${projectId}`} className="text-sm text-muted hover:text-ink">{project.data.name}</Link>
        <h1 className="font-heading mt-1 text-2xl">Export</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-muted">A browser-viewable GLB is not automatically engine-ready. Game-map meshes are levelled, and come with collision and walkable surfaces as separate files.</p>
      </div>

      {!source ? <Notice title="Nothing to export yet">Run a reconstruction first.</Notice> : (
        <Panel title="New package">
          <div className="grid gap-5">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Mesh</span>
              <select value={source.id} onChange={(e) => setSourceId(e.target.value)} className="h-10 rounded-[var(--radius-control)] border border-line bg-canvas px-2">
                {meshes.map((m) => <option key={m.id} value={m.id}>{m.name} · {formatNumber(m.metadata.triangles)} tris{m.metadata.gamemap ? ' · game-ready' : m.metadata.aligned ? ' · levelled' : ' · unprocessed'}</option>)}
              </select>
            </label>
            {!source.metadata.gamemap && <Notice tone="warning" title="Not prepared as a game map">This mesh has no collision or walkable surfaces{source.metadata.aligned ? '' : ' and is not levelled'}. <Link className="text-brass hover:underline" to={`/projects/${projectId}/prepare`}>Prepare it first</Link> for engine use.</Notice>}
            {!source.metadata.scaled && <Notice tone="info">No real-world scale is set, so 1 unit is not 1 metre. The manifest records this.</Notice>}
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Formats</legend>
              {FORMATS.map((f) => (
                <label key={f.id} className="flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1 accent-[var(--color-brass)]" checked={formats.includes(f.id)} onChange={(e) => setFormats(e.target.checked ? [...formats, f.id] : formats.filter((x) => x !== f.id))} />
                  <span><span className="font-medium">{f.label}</span><span className="block text-muted">{f.body}</span></span>
                </label>
              ))}
              <p className="text-xs text-faint">FBX is not offered: no validated FBX exporter is bundled. Convert the GLB in Blender if needed.</p>
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Include</legend>
              <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="accent-[var(--color-brass)]" disabled={!hasCollision} checked={hasCollision && withCollision} onChange={(e) => setWithCollision(e.target.checked)} /> Collision mesh {!hasCollision && <span className="text-faint">(none for this mesh)</span>}</label>
              <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="accent-[var(--color-brass)]" disabled={!hasWalkable} checked={hasWalkable && withWalkable} onChange={(e) => setWithWalkable(e.target.checked)} /> Walkable surface {!hasWalkable && <span className="text-faint">(none for this mesh)</span>}</label>
            </fieldset>
            {action.error && <Notice tone="error">{action.error.message}</Notice>}
            <Button
              variant="primary"
              className="justify-self-start"
              disabled={!formats.length || (job ? !isTerminal(job) : false)}
              loading={action.isPending}
              onClick={() => action.mutate({ path: `/assets/${source.id}/export`, body: { formats, includeCollision: withCollision, includeWalkable: withWalkable } })}
            >
              Create package
            </Button>
            {job && !isTerminal(job) && <JobTimeline job={job} />}
            {job?.status === 'failed' && <JobTimeline job={job} />}
          </div>
        </Panel>
      )}

      <Panel title="Packages">
        {packages.length ? <div className="grid gap-4">{packages.map((p) => <Package key={p.id} asset={p} />)}</div> : <p className="text-sm text-muted">Packages you create appear here with their manifest and validation results.</p>}
      </Panel>
    </div>
  );
}
