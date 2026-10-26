import { Bounds, GizmoHelper, GizmoViewport, Grid, Html, OrbitControls, OrthographicCamera, PerspectiveCamera, useBounds, useProgress } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Asset } from '../../api/types';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { AssetLayer } from './AssetLayer';
import { loadErrorMessage } from './layers';
import { useStudio } from './store';

/** DOM overlay (outside the canvas): drei's <Html> inside a Suspense fallback breaks on unmount. */
function LoadingOverlay() {
  const { progress, active } = useProgress();
  if (!active) return null;
  return (
    <div role="status" className="pointer-events-none absolute inset-0 grid place-items-center">
      <span className="rounded-[var(--radius-control)] border border-line bg-panel/90 px-3 py-1.5 text-xs text-muted">
        Loading model{progress > 0 && progress < 100 ? ` ${Math.round(progress)}%` : ''}
      </span>
    </div>
  );
}

/** Reports a layer's load failure to the store; renders nothing inside the 3D scene. */
function LayerBoundary({ asset, children }: { asset: Asset; children: ReactNode }) {
  const reportError = useStudio((s) => s.reportError);
  const nonce = useStudio((s) => s.reloadNonce[asset.id] ?? 0);
  return (
    <ErrorBoundary
      resetKey={nonce}
      fallback={(error) => <ReportOnce id={asset.id} message={`${asset.name} could not be loaded: ${loadErrorMessage(error)}`} report={reportError} />}
    >
      {children}
    </ErrorBoundary>
  );
}


function ReportOnce({ id, message, report }: { id: string; message: string; report: (id: string, m: string) => void }) {
  useEffect(() => report(id, message), [id, message, report]);
  return null;
}

function FitOnRequest({ deps }: { deps: unknown }) {
  const bounds = useBounds();
  const fitNonce = useStudio((s) => s.fitNonce);
  useEffect(() => {
    bounds.refresh().clip().fit();
  }, [bounds, fitNonce, deps]);
  return null;
}

function BoundsOverlay({ units }: { units: string }) {
  const stats = useStudio((s) => s.stats);
  const visible = useStudio((s) => s.visible);
  const box = useMemo(() => {
    const b = new THREE.Box3();
    for (const [id, st] of Object.entries(stats)) if (visible[id]) b.union(new THREE.Box3(new THREE.Vector3(...st.min), new THREE.Vector3(...st.max)));
    return b.isEmpty() ? null : b;
  }, [stats, visible]);
  if (!box) return null;
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const fmt = (v: number) => `${v.toFixed(2)} ${units}`;
  const label = 'rounded bg-canvas/85 px-1.5 py-0.5 text-[11px] text-ink whitespace-nowrap';
  return (
    <group>
      <box3Helper args={[box, new THREE.Color('#c9a45c')]} />
      <Html position={[c.x, box.min.y, box.max.z]} center><span className={label}>X {fmt(size.x)}</span></Html>
      <Html position={[box.max.x, c.y, box.max.z]} center><span className={label}>Y {fmt(size.y)}</span></Html>
      <Html position={[box.max.x, box.min.y, c.z]} center><span className={label}>Z {fmt(size.z)}</span></Html>
    </group>
  );
}

export function Viewport({ layers, units, opacityFor }: { layers: Asset[]; units: string; opacityFor?: (a: Asset) => number }) {
  const { mode, projection, showGrid, showBounds } = useStudio();
  const layerKey = layers.map((l) => l.id).join(',');

  return (
    <>
    <Canvas dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: false }} className="!absolute inset-0" aria-label="3D viewport">
      <color attach="background" args={['#16181b']} />
      {projection === 'perspective' ? (
        <PerspectiveCamera makeDefault position={[6, 5, 8]} fov={50} near={0.01} far={5000} />
      ) : (
        <OrthographicCamera makeDefault position={[6, 5, 8]} zoom={60} near={-5000} far={5000} />
      )}
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 10, 6]} intensity={1.6} />
      <directionalLight position={[-6, 4, -5]} intensity={0.5} />
      {showGrid && <Grid infiniteGrid cellSize={0.5} sectionSize={5} cellColor="#2b2f35" sectionColor="#3b4047" fadeDistance={80} />}
      <Suspense fallback={null}>
        <Bounds margin={1.25}>
          {layers.map((a) => (
            <LayerBoundary key={a.id} asset={a}>
              <AssetLayer asset={a} mode={mode} opacity={opacityFor?.(a)} />
            </LayerBoundary>
          ))}
          <FitOnRequest deps={layerKey} />
        </Bounds>
        {showBounds && <BoundsOverlay units={units} />}
      </Suspense>
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#e0705a', '#86b97a', '#5fb3c9']} labelColor="#16181b" />
      </GizmoHelper>
    </Canvas>
    <LoadingOverlay />
    </>
  );
}
