import type { Asset } from '../../api/types';
import { HEAVY_BYTES, HEAVY_TRIANGLES } from './store';

export const VIEWABLE = new Set(['point_cloud_sparse', 'point_cloud_dense', 'mesh_visual', 'mesh_collision', 'walkable']);
export const isHeavy = (a: Asset) => (a.metadata.triangles ?? 0) > HEAVY_TRIANGLES || (a.metadata.points ?? 0) > HEAVY_TRIANGLES || a.sizeBytes > HEAVY_BYTES;
export const unitsOf = (a?: Asset) => (a?.metadata.scaled ? 'm' : 'units');
