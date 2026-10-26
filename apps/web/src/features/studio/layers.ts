import type { Asset } from '../../api/types';
import { HEAVY_BYTES, HEAVY_TRIANGLES } from './store';

export const VIEWABLE = new Set(['point_cloud_sparse', 'point_cloud_dense', 'mesh_visual', 'mesh_collision', 'walkable']);
export const isHeavy = (a: Asset) => (a.metadata.triangles ?? 0) > HEAVY_TRIANGLES || (a.metadata.points ?? 0) > HEAVY_TRIANGLES || a.sizeBytes > HEAVY_BYTES;
export const unitsOf = (a?: Asset) => (a?.metadata.scaled ? 'm' : 'units');

/** Plain-language reason for a failed model load; raw loader messages and URLs are never shown. */
export function loadErrorMessage(error: Error) {
  if (/\b404\b|not found/i.test(error.message)) return 'the file is missing.';
  if (/JSON|magic|glTF|parse|Unexpected token|Invalid typed array/i.test(error.message)) return 'the file is not a valid 3D model.';
  return 'the download failed or the file is damaged. Retry, or re-run the step that produced it.';
}
