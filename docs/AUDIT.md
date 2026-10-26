# Phase 0 audit (2026-10-26)

## Reference repository — `kryptonian7734/3d-reconstruction-system`

Read in full (backend) and skimmed (frontend), ~3k lines.

| Finding | Detail | Consequence for Scan2World |
|---|---|---|
| **No LICENSE file** | All rights reserved by default | No code copied; only ideas reused (COLMAP stage order, outlier → normals → Poisson, blur/feature heuristics). Everything here is a fresh implementation. |
| Single FastAPI process | Jobs via `BackgroundTasks`, state in a JSON file under a lock | Replaced by Postgres-persisted jobs, BullMQ, a separate worker and per-job python status files. |
| Hardcoded Windows paths | `C:\Program Files\colmap\bin\colmap.exe`, a venv path in `start.txt` | All paths come from environment / storage keys. |
| Path traversal | Uploads saved as `os.path.join(job_dir, file.filename)` | Server-generated storage keys; traversal guards in Node and Python. |
| No subprocess timeouts or cancellation | `subprocess.run(..., check=True)` | Per-stage timeouts, process-group kill on cancel. |
| **COLMAP flags outdated** | `--SiftExtraction.max_image_size` — COLMAP 4 uses `--FeatureExtraction.max_image_size` / `use_gpu` | Flags taken from `colmap <cmd> -h` of the pinned image (COLMAP 4.2.1). |
| Incomplete dependencies | `requirements.txt` lists 3 packages; code imports opencv, open3d, numpy, pillow | Pinned per-service requirements. |
| Mesh orientation | Unconditional X+90° rotation "to Y-up" | Wrong for arbitrary COLMAP frames; replaced by floor detection (camera up vectors + RANSAC). |
| GLB claim | `o3d.io.write_triangle_mesh(model.glb)` | Not executed as-is (COLMAP missing on host); our pipeline exports via trimesh and re-reads every output. |
| Frontend | CRA + MUI + plain Three.js, polling | Replaced by Vite/React/R3F. |
| Tests | CRA default only | — |

## Environment (this machine)

Ubuntu 24.04 (not the Windows host the brief assumed), 28 cores, 15 GB RAM, ~36 GB free at start,
RTX 4070 12 GB, Docker 29 + Compose v5, Node 22, Python 3.12 (no 3.11). **NVIDIA container runtime not
installed** → reconstruction verified CPU-only (sparse). A Docker Desktop context also exists; on Linux its
VM has no GPU passthrough and separate volumes — use the `default` context.
