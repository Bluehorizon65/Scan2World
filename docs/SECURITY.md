# Security

| Area | Measure | Tested by |
|---|---|---|
| Passwords | argon2id; min 10 chars | `auth.e2e-spec.ts` |
| Sessions | JWT in httpOnly, SameSite=Lax cookie (`COOKIE_SECURE=true` behind HTTPS) | `auth.e2e-spec.ts` (cookie flags, forged token) |
| Authorization | Global default-deny guard; every project/upload/job/asset query is scoped to the owner; unowned = 404 | projects, uploads, jobs, geometry-jobs e2e (cross-user 404s, downloads) |
| Uploads | Size limit per request (multer), signature check (JPEG/PNG/WebP), full decode with sharp, sha256 dedupe, server-generated keys, temp files always removed | `uploads.e2e-spec.ts` |
| Paths | Storage keys validated segment-by-segment in Node and Python; resolved paths must stay under `DATA_DIR` | `storage.service.spec.ts`, `test_common.py` |
| Subprocesses | Argument lists only, own process group, per-stage timeout, SIGTERM→SIGKILL on cancel | `test_recon.py` |
| Internal services | Not published; shared `SERVICE_TOKEN` header (constant-time compare); Python errors never leak tracebacks | `test_common.py` |
| Error surface | Uniform error body; stack traces and internal codes stay in logs; Python 401/404/5xx surface as 502 | `validation.e2e-spec.ts` |
| Rate limits | Global throttle; tighter on auth (`AUTH_RATE_LIMIT`) and job creation (`JOB_RATE_LIMIT`) | — |
| Headers/CORS | helmet; CORS allowlist `WEB_ORIGIN`; nginx `nosniff`, `X-Frame-Options DENY` | — |
| Logs | Pino with cookie/authorization/service-token redaction; request ids | — |
| Disk | Uploads and jobs refused below `MIN_FREE_DISK_GB` | — |
| Containers | Non-root users in every image except the base layers (`postgres`, `redis`); secrets only via `.env` | — |

Not handled: email verification, password reset, account lockout, archive (zip) uploads (not accepted at all),
malware scanning, multi-tenant quotas. Dependency audits run in CI in report-only mode.
