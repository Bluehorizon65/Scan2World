import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type HeroStage = 'photos' | 'points' | 'mesh' | 'collision';

interface Sample {
  positions: number[];
  colors: number[];
  cameras: { center: number[]; up: number[]; forward?: number[] }[];
}

function useSample() {
  const [sample, setSample] = useState<Sample | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([fetch('/sample/points.json').then((r) => r.json()), fetch('/sample/cameras.json').then((r) => r.json())])
      .then(([p, c]) => alive && setSample({ ...p, cameras: c.cameras }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return sample;
}

/** Fades a material's opacity toward a target each frame (or snaps under reduced motion). */
function useFade(target: number, reduced: boolean) {
  const ref = useRef<THREE.Material & { opacity: number }>(null);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    m.opacity = reduced ? target : THREE.MathUtils.damp(m.opacity, target, 6, dt);
    m.visible = m.opacity > 0.01;
  });
  return ref;
}

function Frustums({ cameras, show, reduced }: { cameras: Sample['cameras']; show: number; reduced: boolean }) {
  const geometry = useMemo(() => {
    const pts: number[] = [];
    const s = 0.22;
    for (const c of cameras) {
      const o = new THREE.Vector3(...c.center);
      const up = new THREE.Vector3(...c.up).normalize();
      const fwd = c.forward ? new THREE.Vector3(...c.forward).normalize() : o.clone().negate().setY(0).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
      const corners = [[-1, -0.75], [1, -0.75], [1, 0.75], [-1, 0.75]].map(([x, y]) =>
        o.clone().addScaledVector(fwd, s * 1.4).addScaledVector(right, x * s).addScaledVector(up, y * s),
      );
      for (const k of corners) pts.push(...o.toArray(), ...k.toArray());
      for (let i = 0; i < 4; i++) pts.push(...corners[i].toArray(), ...corners[(i + 1) % 4].toArray());
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }, [cameras]);
  const mat = useFade(show, reduced);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial ref={mat} color="#c9a45c" transparent opacity={0} />
    </lineSegments>
  );
}

function Points({ sample, show, reduced }: { sample: Sample; show: number; reduced: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(sample.positions, 3));
    g.setAttribute('color', new THREE.Uint8BufferAttribute(sample.colors, 3, true));
    return g;
  }, [sample]);
  const mat = useFade(show, reduced);
  return (
    <points geometry={geometry}>
      <pointsMaterial ref={mat} size={0.035} vertexColors transparent opacity={0} sizeAttenuation depthWrite={false} />
    </points>
  );
}

// Reconstructed rooms have inward-facing normals, so front-face culling gives a dollhouse view into the room.
function MeshLayer({ url, show, reduced, wire }: { url: string; show: number; reduced: boolean; wire?: boolean }) {
  const gltf = useLoader(GLTFLoader, url);
  const geometry = useMemo(() => {
    let g: THREE.BufferGeometry | null = null;
    gltf.scene.traverse((o) => {
      if (!g && (o as THREE.Mesh).isMesh) g = (o as THREE.Mesh).geometry;
    });
    return g!;
  }, [gltf]);
  const mat = useFade(show, reduced);
  return (
    <mesh geometry={geometry} renderOrder={wire ? 2 : 1}>
      {wire ? (
        <meshBasicMaterial ref={mat} color="#5fb3c9" wireframe transparent opacity={0} depthWrite={false} />
      ) : (
        <meshBasicMaterial ref={mat} vertexColors transparent opacity={0} side={THREE.FrontSide} />
      )}
    </mesh>
  );
}

const VISIBILITY: Record<HeroStage, [number, number, number, number]> = {
  // frustums, points, mesh, collision
  photos: [1, 0.25, 0, 0],
  points: [0.35, 1, 0, 0],
  mesh: [0, 0, 1, 0],
  collision: [0, 0, 0.35, 0.9],
};

export default function HeroScene({ stage }: { stage: HeroStage }) {
  const sample = useSample();
  const reduced = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const [f, p, m, c] = VISIBILITY[stage];
  return (
    <Canvas camera={{ position: [7.5, 6.5, 8.5], fov: 42 }} dpr={[1, 2]} aria-label="Sample reconstruction preview">
      <color attach="background" args={['#16181b']} />
      <group position={[0, -1.2, 0]}>
        <Suspense fallback={null}>
          {sample && (
            <>
              <Frustums cameras={sample.cameras} show={f} reduced={reduced} />
              <Points sample={sample} show={p} reduced={reduced} />
            </>
          )}
          <MeshLayer url="/sample/mesh.glb" show={m} reduced={reduced} />
          <MeshLayer url="/sample/collision.glb" show={c} reduced={reduced} wire />
        </Suspense>
      </group>
      <OrbitControls enableZoom={false} enablePan={false} autoRotate={!reduced} autoRotateSpeed={0.5} target={[0, 0, 0]} />
    </Canvas>
  );
}
