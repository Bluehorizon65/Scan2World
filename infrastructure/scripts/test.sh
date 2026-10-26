#!/usr/bin/env bash
# Runs every automated suite. Needs Postgres/Redis up (docker compose up -d postgres redis).
#   infrastructure/scripts/test.sh          unit + integration suites
#   infrastructure/scripts/test.sh --e2e    also the Playwright journey against the running stack
set -euo pipefail
cd "$(dirname "$0")/../.."
root=$(pwd)

echo "== Python services =="
if [ ! -x services/.venv/bin/python ]; then
  python3 -m venv services/.venv
  services/.venv/bin/pip install -q -r services/requirements-dev.txt -r services/vision/requirements.txt -r services/geometry/requirements.txt -r services/recon/requirements.txt
fi
(cd services && .venv/bin/ruff check . && .venv/bin/pyright common vision recon geometry)
for s in common vision recon geometry; do
  (cd "services/$s" && "$root/services/.venv/bin/python" -m pytest -q -p no:logging tests)
done

echo "== API =="
(cd apps/api && npm ci --silent && npx prisma generate >/dev/null && npm run lint -- --max-warnings=0 && npx tsc --noEmit -p tsconfig.json && npx jest && npx jest --config test/jest-e2e.json)

echo "== Web =="
(cd apps/web && npm ci --silent && npm run lint && npm run typecheck && npm test)

if [ "${1:-}" = "--e2e" ]; then
  echo "== End-to-end (Playwright) =="
  (cd tests && npm ci --silent && npx playwright install chromium >/dev/null && npx playwright test)
fi
echo "All suites passed."
