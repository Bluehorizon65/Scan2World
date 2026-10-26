#!/usr/bin/env bash
# Builds and starts the full stack, using the GPU override when the NVIDIA runtime is available.
set -euo pipefail
cd "$(dirname "$0")/../.."
files=(-f docker-compose.yml -f docker-compose.override.yml)
if docker info 2>/dev/null | grep -qi 'runtimes:.*nvidia'; then files+=(-f docker-compose.gpu.yml); echo "GPU override enabled"; fi
docker compose "${files[@]}" up -d --build
printf 'Waiting for the API'
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:${API_PORT:-3000}/api/v1/ready" >/dev/null 2>&1; then echo; break; fi
  printf '.'; sleep 2
done
curl -fsS "http://localhost:${API_PORT:-3000}/api/v1/ready" && echo
echo "Open http://localhost:${WEB_PORT:-8080}"
