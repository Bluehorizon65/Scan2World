# CLAUDE.md

Monorepo: `apps/api` (NestJS: HTTP + `dist/worker` BullMQ worker), `apps/web` (Vite/React/R3F),
`services/{common,vision,recon,geometry}` (FastAPI; `common` = shared `s2w_common` package),
`tests/` (Playwright journeys + synthetic photo fixture), `infrastructure/scripts/`.

## Commands
- Stack: `infrastructure/scripts/dev.sh` (or `docker compose up -d --build`). Use the `default` Docker context on Linux.
- All tests: `infrastructure/scripts/test.sh` (needs `docker compose up -d postgres redis`); `--e2e` for Playwright.
- API: `cd apps/api && npx jest` (unit) / `npx jest --config test/jest-e2e.json` (e2e, test DB `scan2world_test`, data in `.test-data/`).
- Web: `cd apps/web && npm test && npm run typecheck && npm run lint`.
- Python: `cd services/<svc> && ../.venv/bin/python -m pytest -q tests`; lint `cd services && .venv/bin/ruff check . && .venv/bin/pyright common vision recon geometry`.
- Migrations: edit `apps/api/prisma/schema.prisma`, then `npx prisma migrate dev --name <x>` with `DATABASE_URL` pointing at 127.0.0.1:5432.

## Rules that matter
- Never expose storage keys or paths in API responses (`publicAsset` strips them). New file locations go through
  `StorageService.path` / `resolve_key` with generated keys.
- Every job status change goes through `JobsService.transition` (validated state machine, publishes SSE).
- Jobs are completed only after outputs exist and the geometry service re-read them (`AssetsService.register`).
- Never modify a source asset; processing writes a new asset with `parentAssetId` and recorded ops.
- Subprocesses: argument lists, timeouts, process groups. No shell strings.
- Don't fabricate progress: show `job.progress` only when parsed from tool output.
- Python services are internal (no published ports) and require `X-Service-Token`.
- Tailwind colour token is `canvas` (not `base`, which collides with `text-base`).
- `docker compose down -v` deletes all data; never use it as a fix.
