import { JobKind } from '@prisma/client';
import { ConnectionOptions } from 'bullmq';
import { env } from '../env';

/** Reconstruction is GPU-bound (concurrency 1); geometry work gets its own queue so it isn't stuck behind it. */
export const QUEUE_FOR: Record<JobKind, 'reconstruction' | 'geometry'> = {
  reconstruction: 'reconstruction',
  processing: 'geometry',
  gamemap: 'geometry',
  export: 'geometry',
};

export interface QueuePayload {
  jobId: string;
}

export function bullConnection(): ConnectionOptions {
  const url = new URL(env.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    db: Number(url.pathname.slice(1) || 0),
    maxRetriesPerRequest: null,
  };
}
