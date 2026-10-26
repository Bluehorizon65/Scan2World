import { useLoader } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assetUrl } from '../../api/client';
import type { Asset } from '../../api/types';
import { useStudio, type ViewMode } from './store';

const OVERLAY: Partial<Record<Asset['assetType'], string>> = { mesh_collision: '#5fb3c9', walkable: '#86b97a' };

/** All meshes of a GLB merged into one BufferGeometry with transforms baked in. */
function useGlbGeometry(url: string): THREE.BufferGeometry {
  const gltf = useLoader(GLTFLoader, url);
  return useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const g = (o as THREE.Mesh).geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
        parts.push(g);
      }
    });
    if (!parts.length) throw new Error('The file contains no meshes');
    const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (!merged) throw new Error('The meshes could not be combined');
    if (!merged.attributes.normal) merged.computeVertexNormals();
    return merged;
  }, [gltf]);
}

type LayerProps = { asset: Asset; mode: ViewMode; opacity?: number };

function GlbLayer(props: LayerProps & { url: string }) {
  return <LayerRender {...props} geometry={useGlbGeometry(props.url)} />;
}

function PlyLayer(props: LayerProps & { url: string }) {
  return <LayerRender {...props} geometry={useLoader(PLYLoader, props.url)} />;
}

export function AssetLayer(props: LayerProps) {
  const nonce = useStudio((s) => s.reloadNonce[props.asset.id] ?? 0);
  const url = `${assetUrl(props.asset.id)}${nonce ? `?r=${nonce}` : ''}`;
  return props.asset.format === 'ply' ? <PlyLayer {...props} url={url} /> : <GlbLayer {...props} url={url} />;
}

function LayerRender({ asset, mode, opacity = 1, geometry }: LayerProps & { geometry: THREE.BufferGeometry }) {
  const reportStats = useStudio((s) => s.reportStats);
  const isCloud = asset.format === 'ply' && !geometry.index;
  const hasColor = !!geometry.attributes.color;
  const overlay = OVERLAY[asset.assetType];

  useEffect(() => {
    geometry.computeBoundingBox();
    const b = geometry.boundingBox!;
    const vertices = geometry.attributes.position.count;
    reportStats(asset.id, {
      vertices: isCloud ? 0 : vertices,
      triangles: isCloud ? 0 : geometry.index ? geometry.index.count / 3 : vertices / 3,
      points: isCloud ? vertices : 0,
      min: [b.min.x, b.min.y, b.min.z],
      max: [b.max.x, b.max.y, b.max.z],
    });
  }, [geometry, asset.id, isCloud, reportStats]);

  // A 1/400th of the model's size reads as a point at any scale.
  const pointSize = useMemo(() => {
    geometry.computeBoundingSphere();
    return Math.max(geometry.boundingSphere!.radius / 400, 1e-4);
  }, [geometry]);

  if (isCloud || mode === 'points')
    return (
      <points geometry={geometry}>
        <pointsMaterial size={pointSize * (isCloud ? 2.5 : 1.5)} vertexColors={hasColor} color={hasColor ? '#ffffff' : overlay ?? '#c9c4ba'} sizeAttenuation />
      </points>
    );

  if (overlay)
    return (
      <mesh geometry={geometry} renderOrder={2}>
        {asset.assetType === 'mesh_collision' ? (
          <meshBasicMaterial color={overlay} wireframe transparent opacity={0.55 * opacity} depthWrite={false} />
        ) : (
          <meshBasicMaterial color={overlay} transparent opacity={0.45 * opacity} side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        )}
      </mesh>
    );

  return (
    <mesh geometry={geometry}>
      {mode === 'wireframe' ? (
        <meshBasicMaterial color="#c9a45c" wireframe transparent opacity={0.7 * opacity} />
      ) : mode === 'color' && hasColor ? (
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} transparent={opacity < 1} opacity={opacity} />
      ) : (
        <meshStandardMaterial color="#b8b3a8" roughness={0.85} metalness={0} flatShading side={THREE.DoubleSide} transparent={opacity < 1} opacity={opacity} />
      )}
    </mesh>
  );
}
