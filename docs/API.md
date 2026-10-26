# API

Base path `/api/v1`. Interactive OpenAPI: `http://localhost:3000/api/docs` (JSON: `/api/docs-json`).
Auth: httpOnly `s2w_session` cookie (JWT, 7 days). Errors: `{ "error": { "code", "message", "requestId", "details?" } }`.
Every response carries `x-request-id`. Resources you don't own return **404** (same as missing).

| Method & path | Purpose |
|---|---|
| `GET /health`, `GET /ready` | Liveness; readiness with database/redis/service status |
| `GET /config` | Upload limits (`maxImages`, `maxFileBytes`, `minImages`) |
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Accounts (argon2id, rate-limited) |
| `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id` | Projects (`?q=&page=&pageSize=`) |
| `POST /projects/:id/uploads` (multipart `file`) | One image per request; JPEG/PNG/WebP by signature, decoded, deduplicated |
| `GET /projects/:id/uploads`, `DELETE …/:uploadId`, `GET …/:uploadId/thumbnail`, `GET …/:uploadId/file` | Upload management |
| `POST /projects/:id/validate` | Capture-quality analysis (vision service) |
| `POST /projects/:id/jobs/reconstruction` `{ quality, matcher, dense }` | Start COLMAP reconstruction |
| `GET /projects/:id/jobs`, `GET /jobs/:id`, `GET /jobs/:id/events` (SSE), `GET /jobs/:id/log` | Job status, timeline, live events, COLMAP log tail |
| `POST /jobs/:id/cancel`, `POST /jobs/:id/retry` | Cancel / retry |
| `GET /projects/:id/assets`, `GET /assets/:id`, `GET /assets/:id/download` | Assets and owner-checked downloads |
| `POST /assets/:id/process` `{ ops: [...] }` | `remove_small_components`, `align_floor`, `scale {factor}`, `simplify {targetTriangles}` |
| `POST /assets/:id/gamemap` `{ collisionTargetTriangles, maxSlopeDeg }` | Visual, collision and walkable meshes + report |
| `POST /assets/:id/export` `{ formats: [glb,obj,ply], includeCollision, includeWalkable }` | Validated zip package with manifest |

Notable error codes: `duplicate_upload` 409, `unsupported_file_type` / `unreadable_image` 415, `file_too_large` 413,
`insufficient_storage` 507, `not_enough_images` / `job_in_progress` / `not_a_mesh` 409,
`service_unavailable` / `service_timeout` 503, `service_error` 502.

Internal Python endpoints (not published; require `X-Service-Token`) are listed in the service `app/main.py` files.
