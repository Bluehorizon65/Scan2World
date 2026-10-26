import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import './setup-env';

export default function globalSetup() {
  rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  execSync('npx prisma migrate deploy', { stdio: 'ignore', env: process.env });
}
