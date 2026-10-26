# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Banner "Processing service offline: …" | `docker compose ps` — restart the service (`docker compose up -d <service>`); `docker compose logs <service>` for the reason. Viewing still works. |
| "Cannot reach the Scan2World API" | api container down or still migrating: `docker compose logs api`. |
| `docker compose` shows none of your containers | Wrong Docker context (e.g. Docker Desktop vs native engine): `docker context ls`, `docker context use default`. Contexts have separate volumes. |
| Job fails with `sparse_reconstruction_failed` | Photos did not connect: more overlap (60–80%), one continuous loop, textured surfaces in frame. The job log (`GET /jobs/:id/log`) has COLMAP's output. |
| Mesh has holes / is blobby | No GPU → sparse-only. Install the NVIDIA Container Toolkit (see DEVELOPMENT_SETUP.md). |
| `floor_not_found` when levelling | Too little floor in the reconstruction; photograph the floor more. |
| Upload rejected 415 | Not a real JPEG/PNG/WebP (HEIC is not supported — export as JPEG). |
| Upload/job rejected 507 | Disk below `MIN_FREE_DISK_GB`. Free space; old projects can be deleted in the UI. |
| Job stuck? | Jobs cannot stay "running" forever: stage timeouts, overall timeout, and `worker_lost` on restart. Cancel from the UI if needed. |
| Port already in use | Change `API_PORT` / `WEB_PORT` / `POSTGRES_PORT` / `REDIS_PORT` in `.env`. |
| geometry container restarts with `lib…so: cannot open shared object` | Rebuild the image (`docker compose build geometry`); the Dockerfile verifies imports at build time. |

Never use `docker compose down -v` to fix a problem: it deletes the database and all files.
