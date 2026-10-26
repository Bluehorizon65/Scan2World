// Host-side e2e env: reads the repo .env and points at the localhost-published Postgres/Redis.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dotenv = Object.fromEntries(
  readFileSync(join(__dirname, '../../../.env'), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const pg = `${dotenv.POSTGRES_USER}:${dotenv.POSTGRES_PASSWORD}@127.0.0.1:${dotenv.POSTGRES_PORT ?? 5432}`;
process.env.DATABASE_URL ??= `postgresql://${pg}/scan2world_test`;
process.env.REDIS_URL ??= `redis://127.0.0.1:${dotenv.REDIS_PORT ?? 6379}/1`;
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret';
process.env.SERVICE_TOKEN ??= dotenv.SERVICE_TOKEN;
process.env.DATA_DIR ??= join(__dirname, '../.test-data');
process.env.LOG_LEVEL ??= 'silent';
process.env.WEB_ORIGIN ??= 'http://localhost:8080';
process.env.AUTH_RATE_LIMIT ??= '1000';
process.env.RATE_LIMIT ??= '100000';
process.env.POLL_MS ??= '20';
