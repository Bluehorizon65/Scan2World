# Scan2World Studio

Turn overlapping photos of a real room into a 3D reconstruction, inspect it in the browser, and prepare it as
game assets: a levelled, scaled visual mesh, a separate collision mesh and a candidate walkable floor,
exported as validated GLB/OBJ/PLY packages.

**Stack:** React 19 + R3F (web) · NestJS 11 + Prisma + BullMQ (api, worker) · FastAPI services for photo
checks (OpenCV), reconstruction (COLMAP 4.2.1) and geometry (Open3D, trimesh) · Postgres · Redis · Docker Compose.

## Quick start
```bash
infrastructure/scripts/check-env.sh    # prerequisites; creates .env with random secrets
infrastructure/scripts/dev.sh          # build + start everything
# open http://localhost:8080
```
Then: create a project → add 30–80 overlapping photos → **Check photos** → **Start reconstruction** →
open the 3D studio → **Prepare game map** (level, scale, collision, walkable) → **Export**.
No photos handy? `cd tests && npm ci && npm run fixture` renders 36 photos of a synthetic room into
`tests/fixtures/render-room/out/`.

## What works (verified on this machine)
| Capability | Status |
|---|---|
| Accounts, private projects, uploads with validation and thumbnails | ✔ tested (API e2e) |
| Capture-quality check (blur, exposure, detail, near-duplicates) | ✔ tested |
| COLMAP reconstruction with live stages, measured progress, cancel, retry, restart-safe | ✔ real runs (CPU) |
| Dense reconstruction | ⚠ implemented, **untested here** — needs the NVIDIA Container Toolkit (not installed on this host) |
| Browser studio: layers, colour/solid/wireframe/points, perspective/ortho, interior view, bounds + dimensions, stats | ✔ |
| Floor levelling, wall alignment, real-world scale, cleanup, triangle reduction | ✔ (test room: 6.00 × 3.12 × 5.08 m vs truth 6 × 3 × 5 m) |
| Collision mesh and candidate walkable surface with confidence report | ✔ |
| Navigation mesh | ✘ not implemented (documented; bake in-engine) |
| Export GLB / OBJ / PLY packages with manifest, every file re-validated | ✔ |
| FBX | ✘ not offered |

## Tests
`infrastructure/scripts/test.sh` runs Python (ruff, pyright, pytest), API (eslint, tsc, Jest unit + e2e on real
Postgres/Redis) and web (eslint, tsc, Vitest). `--e2e` adds Playwright journeys against the running stack
(real COLMAP: photos → package, and a failing capture with advice).

## Documentation
[Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Reconstruction](docs/RECONSTRUCTION_PIPELINE.md) ·
[Game map](docs/GAME_MAP_PIPELINE.md) · [Export formats](docs/EXPORT_FORMATS.md) · [Security](docs/SECURITY.md) ·
[Setup](docs/DEVELOPMENT_SETUP.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Design system](docs/DESIGN_SYSTEM.md) ·
[Phase 0 audit](docs/AUDIT.md)

Data persists in Docker volumes. `docker compose down` keeps it; `docker compose down -v` deletes everything.
