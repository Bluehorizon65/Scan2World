import { Global, Injectable, Module } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { AppError } from '../common/app-error';
import { env } from '../env';

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Storage keys -> files under DATA_DIR (a volume shared with the Python services).
 * Keys are always generated server-side; this is the only place they become paths.
 * ponytail: local volume only; an S3 adapter would replace this class's bodies.
 */
@Injectable()
export class StorageService {
  path(key: string): string {
    const parts = key.split('/');
    if (!key || parts.some((p) => p === '.' || p === '..' || !SEGMENT.test(p)))
      throw new Error(`invalid storage key: ${JSON.stringify(key)}`);
    const root = resolve(env.dataDir);
    const full = resolve(root, ...parts);
    if (!full.startsWith(root + sep)) throw new Error(`invalid storage key: ${JSON.stringify(key)}`);
    return full;
  }

  tmpDir() {
    return join(resolve(env.dataDir), 'tmp');
  }

  /** Path for a key with its parent directory created. */
  async prepare(key: string): Promise<string> {
    const dest = this.path(key);
    await mkdir(dirname(dest), { recursive: true });
    return dest;
  }

  async moveIn(tmpPath: string, key: string) {
    await rename(tmpPath, await this.prepare(key));
  }

  async size(key: string): Promise<number | null> {
    return stat(this.path(key)).then(
      (s) => s.size,
      () => null,
    );
  }

  read(key: string) {
    return createReadStream(this.path(key));
  }

  async remove(keyOrPrefix: string) {
    await rm(this.path(keyOrPrefix), { recursive: true, force: true });
  }

  async assertFreeSpace() {
    await mkdir(resolve(env.dataDir), { recursive: true });
    const fs = await statfs(resolve(env.dataDir));
    if (fs.bavail * fs.bsize < env.minFreeDiskBytes)
      throw new AppError(
        507,
        'insufficient_storage',
        'The server is low on disk space; free space before uploading or processing',
      );
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
