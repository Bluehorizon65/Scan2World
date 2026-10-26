# Scan2World Studio — Design Spec

Date: 2026-10-26 · Status: approved in conversation

## 1. Intent

Single developer, local/private use. Turn overlapping photographs of a real space into a real COLMAP
reconstruction, inspect it in a browser studio, and prepare game-oriented assets (visual mesh, separate
collision mesh, candidate walkable area) for export to Unity/Unreal/Blender. Honesty over polish: anything
experimental is labelled as such; nothing is fabricated (no fake progress %, no sample model presented as a
reconstruction, no claimed formats that aren't validated).

Out of scope: deployment, pushing to GitHub, paid services, FBX export, navmesh generation (documented as
not implemented; Recast later).

## 2. Environment facts (audited)

- Ubuntu Linux, 28 cores, 15 GB RAM, ~36 GB free disk, RTX 4070 12 GB.
- Docker 29 / Compose v5. GPU in containers requires nvidia-container-toolkit (user installs).
- Reference repo `kryptonian7734/3d-reconstruction-system` has **no LICENSE** → code is not copied; only
  ideas (COLMAP stage order, outlier→normals→Poisson, blur/feature heuristics) are reused in a fresh
  implementation.

## 3. Architecture

```
browser ──► web (Vite/React)  ──► api (NestJS, :3000, /api/v1) ──► postgres
                                     │  ▲ SSE                      redis (BullMQ)
                                     ▼  │
                                   worker (NestJS BullMQ entrypoint, same image)
                                     │ internal HTTP + X-Service-Token
                     ┌───────────────┼────────────────┐
                   vision          recon            geometry
                (image analysis) (COLMAP, CUDA;   (geometry, game-map,
                                  CPU sparse       export modules)
                                  profile)
                     └──────── shared volume /data ───┘
```

Only `web` and `api` publish ports. Python services sit on the internal network and require a shared
service token header.

### Containers

| Service | Image | Role |
|---|---|---|
| web | node:22 (dev: Vite; prod: nginx static) | UI |
| api | node:22 multi-stage | REST, auth, uploads, SSE, OpenAPI |
| worker | same as api, `node dist/worker.js` | BullMQ consumers, orchestrates Python |
| vision | python:3.11-slim + opencv-headless | dataset validation |
| recon | colmap/colmap (CUDA) + Python 3 + Open3D | COLMAP pipeline + initial mesh |
| geometry | python:3.11-slim + open3d + trimesh | inspect, process, game-map, export |
| postgres | postgres:16 | source of truth |
| redis | redis:7 | queues |

`docker-compose.gpu.yml` adds the NVIDIA device reservation to `recon`. Without it, recon runs
sparse-only (COLMAP PatchMatch requires CUDA) and the UI says so.

### Storage

Named volume mounted at `/data` in api, worker and all Python services. The DB and APIs hold only
storage keys (`projects/<pid>/uploads/<uuid>.jpg`, `projects/<pid>/jobs/<jid>/...`,
`projects/<pid>/assets/<aid>/...`). Keys are generated server-side; each service resolves a key under
`/data` and rejects anything that escapes it. Originals and reconstruction outputs are immutable; every
processing op writes a new Asset with `parentAssetId` and recorded parameters. Disk-space check before
accepting uploads and jobs (`MIN_FREE_DISK_GB`).

## 4. Data model (Prisma)

- **User**: id, email (unique), passwordHash (argon2id), role, timestamps.
- **Project**: id, ownerId→User, name, description, status, settings (json: scaleFactor, units,
  upAxis), timestamps. Index (ownerId, updatedAt).
- **Upload**: id, projectId, storageKey, fileName (display only), contentType, sizeBytes, sha256,
  width, height, metadata (json: blur, brightness, features, duplicateOf), createdAt.
  Unique (projectId, sha256) → exact duplicates rejected.
- **Job** (single table, `kind` = reconstruction | processing | export): id, projectId, kind,
  status, stage, configuration (json), sourceAssetId?, startedAt, completedAt, errorCode,
  errorMessage, diagnostics (json), resultManifest (json), attempts, timestamps.
  One table instead of three: identical lifecycle and state machine; `kind` distinguishes.
- **JobEvent**: id, jobId, stage, status, message, createdAt — the persisted log/timeline.
- **Asset**: id, projectId, jobId?, parentAssetId?, storageKey, assetType (point_cloud_sparse,
  point_cloud_dense, mesh_visual, mesh_collision, walkable, export_package, report), format,
  sizeBytes, metadata (json stats: vertices, triangles, bbox, units), createdAt.

All project-scoped queries filter by `ownerId` from the session; unowned → 404.

## 5. Job state machine

States: `queued → validating → running → processing → exporting → completed`; any non-terminal →
`failed` | `cancelling → cancelled`. Transitions are validated by a single pure function
(`assertTransition(from, to)`) with unit tests. `completed` only after the expected artifacts exist
and pass validation (geometry service reloads them).

Reconstruction stages (shown only when relevant): validation, feature_extraction, feature_matching,
sparse_reconstruction, undistortion, dense_stereo, fusion, meshing, export_validation.

Flow: API creates Job row (queued) → BullMQ job with `jobId` = Job.id (dedupe) → worker POSTs
`/jobs/{id}` to recon (idempotent: existing workspace status returned) → worker polls `GET
/jobs/{id}` every 2 s, writing stage changes as JobEvents and publishing them to Redis pub/sub → API
streams them over SSE `/api/v1/jobs/:id/events`; frontend falls back to polling. Python writes
`status.json` in the job workspace so state survives restarts; on worker startup, jobs stuck in
non-terminal states are re-attached (poll) or failed with `worker_lost`. Cancel: API sets
`cancelling`, worker calls `DELETE /jobs/{id}`, recon kills the COLMAP process group. Per-stage
timeouts; retries only for transient HTTP errors talking to services (not for COLMAP failures).
Recon concurrency = 1 (GPU).

No percentages unless measured (COLMAP prints image counts during extraction/mapper → "12/30
images registered" where parseable); otherwise stage + elapsed time.

## 6. Python services

Shared conventions: FastAPI, Pydantic models, JSON structured logs, `/health`, service token check,
`/data` key resolution with traversal guard, no stack traces in responses (error codes + messages).

**vision** — `POST /analyze {keys[]}` → per image: readable, format, resolution, blur (Laplacian
variance), brightness, contrast, ORB keypoint count, perceptual hash (dHash) for near-duplicates;
dataset: count, near-duplicate groups, rating, recommendations. Explicitly does not claim overlap
estimation.

**recon** — `POST /jobs/{id}` {imageKeys, outputPrefix, quality: draft|balanced|high, matcher:
exhaustive|sequential, dense: bool}; `GET /jobs/{id}`; `DELETE /jobs/{id}`. Runs COLMAP via
argument lists (no shell), with timeouts, logs to `colmap.log`. Outputs: sparse PLY, dense fused PLY
(GPU), mesh PLY + GLB (Open3D Poisson with density trimming; sparse-only uses BPA/Poisson on sparse
points, labelled low-detail), stats.json.

**geometry** —
- `POST /inspect {key}` → vertices, triangles, bbox, dims, components, watertight, has colors/UVs,
  point count for clouds.
- `POST /process {sourceKey, outputPrefix, ops}` ops (ordered, recorded): remove_outliers,
  remove_small_components, align_floor (RANSAC plane → rotate so floor normal = +Y, floor at y=0),
  scale (factor or reference distance), simplify (target triangles, quadric), recompute_normals.
- `POST /gamemap {sourceKey, outputPrefix, collisionTargetTriangles, maxSlopeDeg}` → visual mesh,
  collision mesh (aggressive simplification, separate file), candidate walkable mesh (upward-facing
  triangles within slope and near floor height) + confidence report (floor inlier ratio, area).
- `POST /export {sourceKeys, outputPrefix, formats[glb,obj,ply], includeCollision}` → files, zip
  package, manifest.json (per-file format, size, vertices, triangles, bbox, units, up axis,
  validation = reloaded with trimesh OK). FBX: not offered.

## 7. Node API (`/api/v1`)

auth: register, login, logout, me · projects: CRUD + list/search/paginate · uploads: multipart
`POST /projects/:id/uploads` (limits: count, per-file size, total; magic-byte check for JPEG/PNG/WebP;
sha256 dedupe), list, delete, thumbnail · `POST /projects/:id/validate` (calls vision, persists
results) · jobs: create reconstruction/processing/export, get, list, cancel, retry, events (SSE),
log · assets: list, get, `inspect`, download (streamed, owner-checked) · health, ready.
OpenAPI at `/api/docs`. Errors: `{ error: { code, message, requestId, details? } }`. Request IDs via
header `x-request-id`. Pino logs. Helmet, CORS allowlist, throttling on auth and job creation.

## 8. Frontend

Vite + React + TS, Tailwind, Radix primitives (shadcn-style components owned in repo), lucide, TanStack
Query, Zustand (studio view state), RHF + Zod, R3F + drei. Types generated from OpenAPI
(`openapi-typescript`).

Routes: `/` landing · `/login` `/register` · `/projects` · `/projects/:id` (overview: uploads,
validation, jobs, assets) · `/projects/:id/studio/:assetId?` (3D studio) · `/projects/:id/gamemap`
· `/projects/:id/export`.

Studio: viewport (orbit/pan/zoom, persp/ortho, fit, grid, axes gizmo), modes solid / wireframe /
vertex-color / point cloud, layer list (visual, collision, walkable, point cloud) with visibility,
bbox overlay with dimensions + units, inspector (stats from geometry service, materials), loading
progress, error boundary, large-model warning (> 2M triangles or > 50 MB). Mobile: viewer only.

Design system documented in `docs/DESIGN_SYSTEM.md` (graphite surfaces, one accent, type scale,
tokens as CSS variables) — produced with the frontend-design skill at milestone 3.

## 9. Security

argon2id, httpOnly SameSite=Lax JWT cookie, owner checks everywhere (tested), upload magic bytes +
size limits, generated keys, `/data` traversal guards in Node and Python, subprocess argument lists +
timeouts, service token for internal calls, Python ports unpublished, helmet/CORS/throttling, no
internal paths or stack traces in responses, non-root containers where the base image allows.

## 10. Testing

- Python: pytest per service (synthetic meshes: box room, plane with noise, sphere; image fixtures
  generated in-test with OpenCV). Ruff + pyright.
- Node: Jest unit (state machine, key guard, upload validation) + e2e against real Postgres/Redis in
  Docker (auth, ownership 404s, upload, job lifecycle with a stubbed Python service).
- Frontend: Vitest + RTL (forms, upload, progress, viewer error state).
- E2E: Playwright full journey. Fixture: `tests/fixtures/render-room` renders a textured synthetic
  room from ~30 cameras in headless Chromium → deterministic, license-free photos → real COLMAP run.

## 11. Milestones

1. Infra + auth + projects + uploads end-to-end (compose up, register, create project, upload).
2. Real reconstruction (vision + recon + worker + SSE) → GLB displayed in browser.
3. Design system, landing, project workspace, studio.
4. Geometry processing + game-map workspace.
5. Export packages + downloads.
6. Hardening: cancellation/restart tests, Playwright journey, CI, docs, setup scripts
   (bash verified; PowerShell written but not executable here).
