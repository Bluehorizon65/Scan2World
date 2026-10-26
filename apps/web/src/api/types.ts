// Mirrors the API responses (apps/api, Prisma models without internal storage keys).

export type JobStatus =
  | 'queued' | 'validating' | 'running' | 'processing' | 'exporting'
  | 'completed' | 'failed' | 'cancelling' | 'cancelled';
export type JobKind = 'reconstruction' | 'processing' | 'gamemap' | 'export';
export type AssetType =
  | 'point_cloud_sparse' | 'point_cloud_dense' | 'mesh_visual' | 'mesh_collision' | 'walkable' | 'export_package' | 'report';

export interface User {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface ImageQuality {
  readable: boolean;
  blur: number;
  brightness: number;
  contrast: number;
  keypoints: number;
  issues: string[];
}

export interface Upload {
  id: string;
  projectId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  width: number;
  height: number;
  metadata: { quality?: ImageQuality };
  createdAt: string;
}

export interface DatasetValidation {
  count: number;
  usable: number;
  duplicateGroups: string[][];
  rating: 'good' | 'fair' | 'poor';
  recommendations: string[];
  notes: string[];
  validatedAt: string;
}

export interface JobProgress {
  label: string;
  current: number;
  total: number;
}

export interface JobEvent {
  id: string;
  status: JobStatus;
  stage: string | null;
  message: string | null;
  createdAt: string;
}

export interface Job {
  id: string;
  projectId: string;
  kind: JobKind;
  status: JobStatus;
  stage: string | null;
  configuration: Record<string, unknown>;
  sourceAssetId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  diagnostics: { advice?: string[]; gpu?: boolean; dense?: boolean; stats?: Record<string, number> } & Record<string, unknown>;
  progress: JobProgress | null;
  resultManifest: { assets?: { id: string; type: AssetType }[]; report?: GamemapReport; manifest?: ExportManifest } | null;
  createdAt: string;
  updatedAt: string;
  events?: JobEvent[];
}

export interface ProjectSettings {
  scaleFactor?: number;
  units?: 'm' | 'cm' | 'unitless';
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  settings: ProjectSettings;
  validation: DatasetValidation | null;
  createdAt: string;
  updatedAt: string;
  _count: { uploads: number; assets: number; jobs: number };
  jobs: Pick<Job, 'id' | 'kind' | 'status' | 'stage' | 'createdAt'>[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AssetMetadata {
  kind?: 'mesh' | 'point_cloud';
  vertices?: number;
  triangles?: number;
  points?: number;
  dimensions?: [number, number, number];
  bbox?: { min: number[]; max: number[] };
  components?: number;
  watertight?: boolean;
  hasColors?: boolean;
  hasUVs?: boolean;
  aligned?: boolean;
  scaled?: boolean;
  lowDetail?: boolean;
  gamemap?: boolean;
  ops?: ProcessStep[];
  report?: GamemapReport;
  manifest?: ExportManifest;
  [k: string]: unknown;
}

export interface Asset {
  id: string;
  projectId: string;
  jobId: string | null;
  parentAssetId: string | null;
  name: string;
  assetType: AssetType;
  format: string;
  sizeBytes: number;
  metadata: AssetMetadata;
  createdAt: string;
}

export interface ManifestFile {
  path: string;
  role: string;
  format: string;
  sizeBytes: number;
  triangles?: number;
  vertices?: number;
  validation: 'ok' | 'failed';
}

export interface ExportManifest {
  files: ManifestFile[];
  coordinateSystem: { upAxis: string; handedness: string; units: string; scaleFactor: number | null };
  notes: string[];
}

export interface Ready {
  status: 'ready' | 'unavailable';
  checks: { database: string; redis: string; services: Record<'vision' | 'recon' | 'geometry', 'up' | 'down'> };
}

export interface ProcessStep {
  op: string;
  trianglesBefore: number;
  trianglesAfter: number;
  method?: 'cameras' | 'geometry';
  confidence?: 'low' | 'medium' | 'high';
  floorInlierRatio?: number;
}

export interface GamemapReport {
  alignment: { method: 'cameras' | 'geometry'; confidence: 'low' | 'medium' | 'high'; floorInlierRatio: number } | null;
  visual: { triangles: number; dimensions: number[] };
  collision: { triangles: number; valid: boolean };
  walkable: { areaUnits2: number; coverage: number; confidence: 'low' | 'medium' | 'high'; triangles: number };
  navigation: { status: string; note: string };
  warnings: string[];
}
