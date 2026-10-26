# Development setup

## Requirements
Docker Engine with Compose v2 (Linux) or Docker Desktop with WSL2 (Windows), Node 22, ~30 GB free disk
(images ≈ 13 GB, of which the COLMAP CUDA base is 9 GB). Python 3.12 only for running service tests locally.

## Start
```bash
infrastructure/scripts/check-env.sh   # checks tools, disk, GPU; creates .env with random secrets
infrastructure/scripts/dev.sh         # docker compose up -d --build (+ GPU override when available)
```
Windows: `infrastructure\scripts\check-env.ps1` and `dev.ps1` (written for PowerShell 7; not exercised in CI).

Open http://localhost:8080. API docs: http://localhost:3000/api/docs.

## Everyday Docker commands
```bash
docker compose config            # validate configuration
docker compose build             # build images
docker compose up -d             # start (data persists in named volumes)
docker compose ps                # health of each service
docker compose logs -f worker    # follow logs of one service
docker compose down              # stop and remove containers — volumes (database, uploads, results) are KEPT
```
`docker compose down -v` **deletes all data** (database and every upload/result). It is never needed for
troubleshooting.

## GPU (dense reconstruction)
COLMAP's PatchMatch stereo needs CUDA. On Linux install the NVIDIA Container Toolkit:
```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.gpu.yml up -d recon
```
Use the native engine (`docker context use default`): Docker Desktop on Linux runs a VM without GPU access.
On Windows, Docker Desktop with the WSL2 backend and a current NVIDIA driver exposes the GPU to containers.
Check with `docker compose exec recon nvidia-smi -L`; the recon service reports `gpu: true` in job status and the
UI then shows the dense stages. Without a GPU everything still works with sparse-only, low-detail meshes.

## Local development without rebuilding images
- API: `cd apps/api && npm ci && npm run start:dev` (needs `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`,
  `SERVICE_TOKEN`; Postgres and Redis are published on 127.0.0.1 by `docker-compose.override.yml`).
- Web: `cd apps/web && npm ci && npm run dev` → http://localhost:5173 (proxies `/api` to :3000).
- Python services: `python3 -m venv services/.venv` then install `services/requirements-dev.txt` plus the
  service's requirements. The venv is for tests and debugging; containers are the supported runtime.

## Tests
```bash
docker compose up -d postgres redis
infrastructure/scripts/test.sh          # Python (ruff, pyright, pytest), API (lint, tsc, unit, e2e), web (lint, tsc, vitest)
infrastructure/scripts/test.sh --e2e    # plus Playwright journeys against the running stack (~6 min, real COLMAP)
node infrastructure/scripts/smoke-test.mjs   # API-only journey: photos → reconstruction → game map → package
```
Test photos are rendered deterministically: `cd tests && npm run fixture` (Three.js scene in headless Chromium).

## Configuration (`.env`)
| Variable | Default | Meaning |
|---|---|---|
| `POSTGRES_PASSWORD`, `JWT_SECRET`, `SERVICE_TOKEN` | — | required secrets |
| `API_PORT` / `WEB_PORT` | 3000 / 8080 | published ports |
| `MAX_IMAGES`, `MAX_FILE_MB`, `MIN_FREE_DISK_GB` | 200, 40, 5 | upload and disk limits |
| `RECON_THREADS`, `RECON_MEMORY_LIMIT`, `GEOMETRY_MEMORY_LIMIT` | 8, 10g, 6g | resource limits |
| `RECON_CONCURRENCY`, `GEOMETRY_CONCURRENCY` | 1, 2 | worker concurrency (worker env) |
| `RECON_TIMEOUT_MIN` | by quality (45/180/480) | overall reconstruction time limit |
