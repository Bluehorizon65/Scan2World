const nf = new Intl.NumberFormat('en');

export const formatNumber = (n: number | undefined | null) => (n == null ? '—' : nf.format(n));

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Human labels for pipeline stage identifiers. */
export const STAGE_LABEL: Record<string, string> = {
  validation: 'Checking photos',
  feature_extraction: 'Finding features',
  feature_matching: 'Matching features',
  sparse_reconstruction: 'Recovering cameras and sparse points',
  undistortion: 'Undistorting images',
  dense_stereo: 'Estimating depth',
  fusion: 'Fusing depth maps',
  meshing: 'Building the mesh',
  export_validation: 'Validating outputs',
  mesh_processing: 'Processing the mesh',
  gamemap_preparation: 'Preparing game assets',
  export_packaging: 'Packaging files',
};

export const stageLabel = (s: string | null | undefined) => (s ? (STAGE_LABEL[s] ?? s.replace(/_/g, ' ')) : 'Waiting to start');

export const ASSET_LABEL: Record<string, string> = {
  point_cloud_sparse: 'Sparse point cloud',
  point_cloud_dense: 'Dense point cloud',
  mesh_visual: 'Mesh',
  mesh_collision: 'Collision mesh',
  walkable: 'Walkable surface',
  export_package: 'Export package',
  report: 'Report',
};
