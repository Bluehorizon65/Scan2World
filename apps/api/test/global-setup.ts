import { execSync } from 'node:child_process';
import './setup-env';

export default function globalSetup() {
  execSync('npx prisma migrate deploy', { stdio: 'ignore', env: process.env });
}
