import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as Tooltip from '@radix-ui/react-tooltip';
import clsx from 'clsx';
import { ArrowLeft, Box, DoorOpen, Download, Eye, EyeOff, Grid3x3, Maximize, Ruler, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import { useAssets, useProject } from '../../api/hooks';
import type { Asset } from '../../api/types';
import { Button, Notice, Spinner, Stat } from '../../components/ui';
import { ASSET_LABEL, formatBytes, formatNumber, formatRelative } from '../../lib/format';
import { isHeavy, unitsOf, VIEWABLE } from './layers';
import { useStudio, type ViewMode } from './store';
import { Viewport } from './Viewport';


function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={6} className="z-50 rounded-[var(--radius-control)] border border-line bg-panel px-2 py-1 text-xs text-ink">{label}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

const MODES: { value: ViewMode; label: string }[] = [
  { value: 'color', label: 'Colour' },
  { value: 'solid', label: 'Solid' },
  { value: 'wireframe', label: 'Wireframe' },
  { value: 'points', label: 'Points' },
];

export function Toolbar() {
  const { mode, projection, showGrid, showBounds, interior, set, fit } = useStudio();
  const toggle = 'grid size-8 place-items-center rounded-[var(--radius-control)] text-muted hover:text-ink data-[state=on]:bg-raised data-[state=on]:text-ink';
  return (
    <Tooltip.Provider delayDuration={300}>
      <div role="toolbar" aria-label="View options" className="flex flex-wrap items-center gap-2 rounded-[var(--radius-panel)] border border-line bg-panel/95 p-1 backdrop-blur">
        <ToggleGroup.Root type="single" value={mode} onValueChange={(v) => v && set({ mode: v as ViewMode })} aria-label="Shading" className="flex">
          {MODES.map((m) => (
            <ToggleGroup.Item key={m.value} value={m.value} className="h-8 rounded-[var(--radius-control)] px-2.5 text-sm text-muted hover:text-ink data-[state=on]:bg-raised data-[state=on]:text-ink">
              {m.label}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
        <span className="h-5 w-px bg-line" aria-hidden />
        <ToggleGroup.Root type="single" value={projection} onValueChange={(v) => v && set({ projection: v as 'perspective' | 'orthographic' })} aria-label="Projection" className="flex">
          <ToggleGroup.Item value="perspective" className="h-8 rounded-[var(--radius-control)] px-2.5 text-sm text-muted hover:text-ink data-[state=on]:bg-raised data-[state=on]:text-ink">Perspective</ToggleGroup.Item>
          <ToggleGroup.Item value="orthographic" className="h-8 rounded-[var(--radius-control)] px-2.5 text-sm text-muted hover:text-ink data-[state=on]:bg-raised data-[state=on]:text-ink">Orthographic</ToggleGroup.Item>
        </ToggleGroup.Root>
        <span className="h-5 w-px bg-line" aria-hidden />
        <ToggleGroup.Root
          type="multiple"
          value={[showGrid ? 'grid' : '', showBounds ? 'bounds' : '', interior ? 'interior' : ''].filter(Boolean)}
          onValueChange={(v) => set({ showGrid: v.includes('grid'), showBounds: v.includes('bounds'), interior: v.includes('interior') })}
          aria-label="Helpers"
          className="flex"
        >
          <Tip label="Interior view: cut away walls facing the camera"><ToggleGroup.Item value="interior" aria-label="Interior view" className={toggle}><DoorOpen className="size-4" /></ToggleGroup.Item></Tip>
          <Tip label="Grid"><ToggleGroup.Item value="grid" aria-label="Grid" className={toggle}><Grid3x3 className="size-4" /></ToggleGroup.Item></Tip>
          <Tip label="Bounding box and dimensions"><ToggleGroup.Item value="bounds" aria-label="Bounding box and dimensions" className={toggle}><Ruler className="size-4" /></ToggleGroup.Item></Tip>
        </ToggleGroup.Root>
        <Tip label="Fit to view">
          <button type="button" onClick={fit} aria-label="Fit to view" className={toggle}><Maximize className="size-4" /></button>
        </Tip>
      </div>
    </Tooltip.Provider>
  );
}

function LayerRow({ asset, selected, onSelect }: { asset: Asset; selected: boolean; onSelect: () => void }) {
  const visible = useStudio((s) => !!s.visible[asset.id]);
  const error = useStudio((s) => s.errors[asset.id]);
  const setVisible = useStudio((s) => s.setVisible);
  const [confirmHeavy, setConfirmHeavy] = useState(false);
  const heavy = isHeavy(asset);
  const count = asset.metadata.triangles ? `${formatNumber(asset.metadata.triangles)} tris` : asset.metadata.points ? `${formatNumber(asset.metadata.points)} pts` : '';
  return (
    <li className={clsx('rounded-[var(--radius-control)]', selected && 'bg-raised')}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${asset.name}`}
          aria-pressed={visible}
          onClick={() => (heavy && !visible && !confirmHeavy ? setConfirmHeavy(true) : setVisible(asset.id, !visible))}
          className="grid size-7 place-items-center rounded text-muted hover:text-ink"
        >
          {visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm">{asset.name}</span>
          <span className="block text-xs text-muted">{ASSET_LABEL[asset.assetType]} · {count}</span>
        </button>
      </div>
      {confirmHeavy && !visible && (
        <div className="mx-2 mb-2 grid gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-xs">
          <p>This model is large ({count}, {formatBytes(asset.sizeBytes)}) and may slow or freeze the browser.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setVisible(asset.id, true)}>Load anyway</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmHeavy(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {error && <p className="mx-2 mb-2 text-xs text-danger">{error}</p>}
    </li>
  );
}

export function Inspector({ asset, assets }: { asset?: Asset; assets: Asset[] }) {
  const stats = useStudio((s) => (asset ? s.stats[asset.id] : undefined));
  if (!asset) return <p className="text-sm text-muted">Select a layer to inspect it.</p>;
  const m = asset.metadata;
  const units = unitsOf(asset);
  const dims = m.dimensions ?? (stats ? stats.max.map((v, i) => v - stats.min[i]) : undefined);
  const parent = assets.find((a) => a.id === asset.parentAssetId);
  const align = m.ops?.find((o) => o.op === 'align_floor');
  return (
    <div className="grid gap-5">
      <div>
        <h2 className="font-heading text-base">{asset.name}</h2>
        <p className="text-xs text-muted">{ASSET_LABEL[asset.assetType]} · {asset.format.toUpperCase()} · {formatBytes(asset.sizeBytes)} · {formatRelative(asset.createdAt)}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {m.kind === 'point_cloud' ? <Stat label="Points" value={formatNumber(m.points)} /> : (
          <>
            <Stat label="Triangles" value={formatNumber(m.triangles)} />
            <Stat label="Vertices" value={formatNumber(m.vertices)} />
          </>
        )}
        {dims && <Stat label={`Size (${units})`} value={dims.map((d) => d.toFixed(2)).join(' × ')} />}
        {m.components !== undefined && <Stat label="Connected parts" value={formatNumber(m.components)} />}
        {m.watertight !== undefined && <Stat label="Watertight" value={m.watertight ? 'Yes' : 'No'} />}
        <Stat label="Surface colour" value={m.hasUVs ? 'Texture maps' : m.hasColors ? 'Vertex colours' : 'None'} />
        <Stat label="Orientation" value={m.aligned ? 'Floor-aligned, +Y up' : 'As reconstructed'} />
      </dl>
      {!m.scaled && m.kind === 'mesh' && <Notice tone="info">No real-world scale yet: sizes are in reconstruction units. Set a scale when preparing the game map.</Notice>}
      {m.lowDetail && <Notice tone="warning" title="Low-detail mesh">Built from sparse points because no GPU was available for dense reconstruction.</Notice>}
      {align && (
        <div className="grid gap-1 text-sm">
          <p className="text-muted">Floor alignment</p>
          <p>Confidence {align.confidence} · {align.method === 'cameras' ? 'from camera orientation' : 'from geometry'} · floor covers {((align.floorInlierRatio ?? 0) * 100).toFixed(0)}% of samples</p>
        </div>
      )}
      {m.ops && (
        <div className="grid gap-1 text-sm">
          <p className="text-muted">Processing applied (original kept)</p>
          <ol className="list-decimal pl-5">
            {m.ops.map((o, i) => <li key={i}>{o.op.replace(/_/g, ' ')}{o.trianglesBefore !== o.trianglesAfter ? ` (${formatNumber(o.trianglesBefore)} → ${formatNumber(o.trianglesAfter)} tris)` : ''}</li>)}
          </ol>
        </div>
      )}
      {parent && <p className="text-sm text-muted">Derived from <span className="text-ink">{parent.name}</span></p>}
      <a href={assetUrl(asset.id)} download className="inline-flex h-8 items-center gap-2 justify-self-start rounded-[var(--radius-control)] border border-line bg-raised px-3 text-sm hover:border-faint">
        <Download className="size-4" aria-hidden /> Download {asset.format.toUpperCase()}
      </a>
    </div>
  );
}

export function StatusBar({ units }: { units: string }) {
  const { stats, visible } = useStudio();
  const on = Object.entries(stats).filter(([id]) => visible[id]).map(([, s]) => s);
  const sum = (k: 'triangles' | 'vertices' | 'points') => on.reduce((n, s) => n + s[k], 0);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line bg-panel px-4 py-1.5 text-xs text-muted">
      <span>{on.length} layer{on.length === 1 ? '' : 's'} shown</span>
      <span>{formatNumber(sum('triangles'))} triangles</span>
      <span>{formatNumber(sum('vertices'))} vertices</span>
      {sum('points') > 0 && <span>{formatNumber(sum('points'))} points</span>}
      <span>Units: {units === 'm' ? 'metres' : 'reconstruction units'}</span>
      <span className="ml-auto hidden md:inline">Drag to orbit · right-drag to pan · scroll to zoom</span>
    </div>
  );
}

export function StudioPage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const project = useProject(projectId);
  const assets = useAssets(projectId);
  const { visible, errors, showOnly, retry } = useStudio();
  const viewable = useMemo(() => (assets.data ?? []).filter((a) => VIEWABLE.has(a.assetType)), [assets.data]);
  const selectedId = params.get('asset') ?? viewable.find((a) => a.assetType === 'mesh_visual')?.id ?? viewable[0]?.id;
  const selected = viewable.find((a) => a.id === selectedId);

  useEffect(() => {
    if (selectedId && Object.keys(useStudio.getState().visible).length === 0) {
      const a = viewable.find((x) => x.id === selectedId);
      if (a && !isHeavy(a)) showOnly([selectedId]);
    }
  }, [selectedId, viewable, showOnly]);

  useEffect(() => () => showOnly([]), [showOnly]); // fresh state when leaving the studio

  if (assets.isPending || project.isPending) return <div className="p-6"><Spinner label="Loading the studio" /></div>;
  if (assets.error || project.error) return <div className="p-6"><Notice tone="error" title="Could not load the studio">{(assets.error ?? project.error)!.message}</Notice></div>;

  const layers = viewable.filter((a) => visible[a.id]);
  const units = unitsOf(selected);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] md:h-[calc(100dvh-3.5rem)] md:flex-none md:grid-cols-[260px_1fr_300px] md:grid-rows-[minmax(0,1fr)_auto]">
      <aside aria-label="Scene layers" className="border-b border-line bg-panel p-3 md:row-span-1 md:border-b-0 md:border-r md:overflow-auto">
        <Link to={`/projects/${projectId}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> {project.data.name}
        </Link>
        <h2 className="mb-2 text-xs text-muted">Layers</h2>
        {viewable.length === 0 ? (
          <p className="text-sm text-muted">No 3D results yet. Run a reconstruction from the project page.</p>
        ) : (
          <ul className="grid gap-0.5 max-md:flex max-md:overflow-x-auto">
            {viewable.map((a) => (
              <LayerRow key={a.id} asset={a} selected={a.id === selectedId} onSelect={() => setParams({ asset: a.id })} />
            ))}
          </ul>
        )}
      </aside>

      <section aria-label="Viewport" className="relative min-h-[50vh] overflow-hidden">
        {layers.length ? <Viewport layers={layers} units={units} /> : (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-muted">
            <div className="grid justify-items-center gap-2">
              <Box className="size-8 text-faint" aria-hidden />
              <p>Turn on a layer to view it.</p>
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-center">
          <div className="pointer-events-auto"><Toolbar /></div>
        </div>
        {Object.entries(errors).filter(([id]) => visible[id]).map(([id, msg]) => (
          <div key={id} className="absolute inset-x-3 bottom-3 mx-auto max-w-lg">
            <div role="alert" className="flex items-start gap-3 rounded-[var(--radius-panel)] border border-danger/40 bg-panel p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <p className="flex-1">{msg}</p>
              <Button size="sm" onClick={() => retry(id)}>Retry</Button>
            </div>
          </div>
        ))}
      </section>

      <aside aria-label="Inspector" className="hidden border-l border-line bg-panel p-4 md:block md:overflow-auto">
        <Inspector asset={selected} assets={assets.data} />
      </aside>

      <div className="md:col-span-3"><StatusBar units={units} /></div>
    </div>
  );
}
