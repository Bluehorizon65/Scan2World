import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const FIXTURE_DIR = join(here, '../fixtures/render-room/out');

export default async function globalSetup() {
  if (!existsSync(FIXTURE_DIR) || readdirSync(FIXTURE_DIR).length < 36) {
    execFileSync('node', [join(here, '../fixtures/render-room/render.mjs'), '36', FIXTURE_DIR], { stdio: 'inherit' });
  }
  const res = await fetch(`${process.env.BASE_URL ?? 'http://localhost:8080'}/api/v1/ready`).catch(() => null);
  const ready = res && ((await res.json()) as { status: string; checks: { services: Record<string, string> } });
  if (!ready || ready.status !== 'ready' || Object.values(ready.checks.services).includes('down'))
    throw new Error(`Stack not ready: ${JSON.stringify(ready)}. Start it with: docker compose up -d`);
}
