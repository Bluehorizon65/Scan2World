import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../../api/hooks';
import { Logo } from '../../components/Logo';
import type { HeroStage } from './HeroScene';

const HeroScene = lazy(() => import('./HeroScene'));

const STAGES: { id: HeroStage; label: string; caption: string }[] = [
  { id: 'photos', label: 'Photos', caption: '36 photos, each recovered as a camera position in the room.' },
  { id: 'points', label: 'Points', caption: '27,321 points triangulated from features matched across the photos.' },
  { id: 'mesh', label: 'Mesh', caption: 'A coloured surface built from the points, levelled so the floor sits at zero.' },
  { id: 'collision', label: 'Collision', caption: 'A 1,500-triangle collision mesh, kept separate from the visual mesh.' },
];

const STEPS = [
  { title: 'Capture', body: 'Walk the room and take 30–80 overlapping photos with one camera. Keep textured surfaces in frame.' },
  { title: 'Check', body: 'Each photo is scored for blur, exposure and detail, and near-duplicates are flagged before you spend time reconstructing.' },
  { title: 'Reconstruct', body: 'COLMAP recovers camera poses and a point cloud; a coloured mesh is built from it. Every stage reports as it runs.' },
  { title: 'Prepare', body: 'Level the floor, set real-world scale, reduce triangles, and generate collision and walkable surfaces as separate files.' },
  { title: 'Export', body: 'Download GLB, OBJ or PLY with a manifest describing units, axes and validation for each file.' },
];

const CAPABILITIES: { area: string; works: string; limits: string }[] = [
  { area: 'Reconstruction', works: 'Camera poses and sparse points on CPU; dense point clouds with an NVIDIA GPU.', limits: 'Glass, mirrors and blank walls reconstruct poorly. Without a GPU, meshes are low detail.' },
  { area: 'Mesh processing', works: 'Floor levelling, real-world scale, cleanup of loose fragments, triangle reduction.', limits: 'No texture baking yet — surfaces carry vertex colours.' },
  { area: 'Game-map preparation', works: 'Simplified collision mesh and a candidate walkable floor with a confidence report.', limits: 'No navigation mesh is generated; bake one in your engine from the walkable surface.' },
  { area: 'Export', works: 'GLB, OBJ and PLY, each re-read and validated, packaged with a manifest.', limits: 'No FBX. Convert the GLB in Blender if your pipeline needs it.' },
];

export function Landing() {
  const me = useMe();
  const [stage, setStage] = useState<HeroStage>('mesh');
  const current = STAGES.find((s) => s.id === stage)!;
  const studio = me.data ? '/projects' : '/register';

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
        <Logo />
        <nav className="flex items-center gap-2 text-sm">
          {me.data ? null : <Link to="/login" className="rounded-[var(--radius-control)] px-3 py-2 text-muted hover:text-ink">Sign in</Link>}
          <Link to={studio} className="rounded-[var(--radius-control)] bg-brass px-3 py-2 font-semibold text-canvas hover:bg-brass-strong">Open the studio</Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-8 md:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:pt-16">
          <div className="max-w-xl">
            <h1 className="font-display text-display">Photograph a room. Walk it in your engine.</h1>
            <p className="mt-6 max-w-[52ch] text-lg text-muted">
              Scan2World Studio reconstructs real spaces from ordinary photos and prepares them as game assets: a levelled visual mesh, a separate collision mesh and a candidate walkable floor.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={studio} className="inline-flex h-11 items-center rounded-[var(--radius-control)] bg-brass px-5 font-semibold text-canvas hover:bg-brass-strong">Start a project</Link>
              <a href="#how" className="inline-flex h-11 items-center rounded-[var(--radius-control)] border border-line px-5 text-ink hover:border-faint">How it works</a>
            </div>
          </div>

          <figure className="relative overflow-hidden rounded-[var(--radius-panel)] border border-line bg-panel">
            <div className="aspect-[4/3] w-full">
              <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted">Loading the sample scene</div>}>
                <HeroScene stage={stage} />
              </Suspense>
            </div>
            <figcaption className="grid gap-3 border-t border-line p-4">
              <div role="tablist" aria-label="Pipeline stage" className="grid grid-cols-4 gap-1 rounded-[var(--radius-control)] bg-canvas p-1">
                {STAGES.map((s) => (
                  <button
                    key={s.id}
                    role="tab"
                    aria-selected={stage === s.id}
                    onClick={() => setStage(s.id)}
                    className="h-9 rounded-[3px] text-sm text-muted transition-colors hover:text-ink aria-selected:bg-raised aria-selected:text-ink"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="min-h-[2.5em] text-sm text-muted" aria-live="polite">{current.caption}</p>
              <p className="text-xs text-faint">Sample content: a synthetic test room rendered and reconstructed by this pipeline.</p>
            </figcaption>
          </figure>
        </section>

        <section id="how" className="border-t border-line">
          <div className="mx-auto max-w-7xl px-4 py-16 md:px-8">
            <h2 className="font-heading text-2xl">From photos to a playable space</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-5">
              {STEPS.map((s, i) => (
                <li key={s.title} className="grid content-start gap-2 border-t border-line pt-4">
                  <span className="text-sm text-brass">{i + 1}</span>
                  <h3 className="font-heading text-lg">{s.title}</h3>
                  <p className="text-sm text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-line">
          <div className="mx-auto max-w-7xl px-4 py-16 md:px-8">
            <h2 className="font-heading text-2xl">What it does today, and where it stops</h2>
            <p className="mt-3 max-w-[64ch] text-muted">Reconstruction quality depends on the photos. These are the current limits, so nothing in your export is a surprise.</p>
            <div className="mt-8 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className="py-3 pr-6 font-medium">Area</th>
                    <th scope="col" className="py-3 pr-6 font-medium">Works now</th>
                    <th scope="col" className="py-3 font-medium">Limits</th>
                  </tr>
                </thead>
                <tbody>
                  {CAPABILITIES.map((c) => (
                    <tr key={c.area} className="border-b border-line align-top">
                      <th scope="row" className="py-4 pr-6 font-heading font-medium">{c.area}</th>
                      <td className="py-4 pr-6">{c.works}</td>
                      <td className="py-4 text-muted">{c.limits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="border-t border-line">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-4 py-14 md:px-8">
            <p className="font-heading max-w-[30ch] text-xl">Bring a set of photos of any room and get a validated asset package back.</p>
            <Link to={studio} className="inline-flex h-11 items-center rounded-[var(--radius-control)] bg-brass px-5 font-semibold text-canvas hover:bg-brass-strong">Start a project</Link>
          </div>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-7xl px-4 py-6 text-xs text-faint md:px-8">Scan2World Studio. Reconstruction by COLMAP; geometry by Open3D and trimesh.</div>
      </footer>
    </div>
  );
}
