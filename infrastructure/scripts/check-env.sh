#!/usr/bin/env bash
# Checks prerequisites and creates .env (random secrets) if missing. Never deletes or overwrites anything.
set -uo pipefail
cd "$(dirname "$0")/../.."
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED=1; }
FAILED=0

echo "Tools"
for t in git docker node npm; do
  if command -v "$t" >/dev/null; then ok "$t $("$t" --version 2>&1 | head -1)"; else fail "$t not found"; fi
done
if docker compose version >/dev/null 2>&1; then ok "$(docker compose version)"; else fail "docker compose plugin not found"; fi
if docker info >/dev/null 2>&1; then ok "Docker daemon reachable (context: $(docker context show))"; else fail "Docker daemon not reachable"; fi
if [ "$(uname -s)" = Linux ] && [ "$(docker context show 2>/dev/null)" = desktop-linux ]; then
  warn "Docker Desktop context on Linux: its VM has no NVIDIA GPU and separate volumes. For GPU use: docker context use default"
fi
command -v python3 >/dev/null && ok "python3 $(python3 --version 2>&1) (only needed for local service tests)" || warn "python3 not found (only needed for local service tests)"

echo "GPU"
if docker info 2>/dev/null | grep -qi 'runtimes:.*nvidia'; then
  ok "NVIDIA container runtime available: dense reconstruction enabled with docker-compose.gpu.yml"
else
  warn "No NVIDIA container runtime: reconstruction runs CPU-only (sparse, low-detail meshes). See docs/DEVELOPMENT_SETUP.md"
fi

echo "Disk"
free_gb=$(df -Pk . | awk 'NR==2 {print int($4/1024/1024)}')
if [ "$free_gb" -ge 25 ]; then ok "${free_gb} GB free"; else warn "${free_gb} GB free — images need ~13 GB and reconstructions several GB each"; fi

echo "Configuration"
if [ -f .env ]; then
  ok ".env exists (left unchanged)"
  if grep -v '^#' .env | grep -q 'change-me'; then warn ".env still contains change-me values"; fi
else
  r() { openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(r)/" -e "s/^JWT_SECRET=.*/JWT_SECRET=$(r)/" \
      -e "s/^SERVICE_TOKEN=.*/SERVICE_TOKEN=$(r)/" .env.example > .env
  ok "created .env with random secrets"
fi
docker compose config -q && ok "docker compose config is valid" || fail "docker compose config is invalid"

exit $FAILED
