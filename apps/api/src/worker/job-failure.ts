import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error';
import { JobsService } from '../jobs/jobs.service';
import { isTerminal } from '../jobs/state-machine';
import { PrismaService } from '../prisma.service';

const logger = new Logger('JobFailure');

/** Moves a live job to `failed` with a user-safe code/message; unknown errors are logged, never shown. */
export async function failJob(prisma: PrismaService, jobs: JobsService, jobId: string, err: unknown) {
  const known = err instanceof AppError;
  if (!known) logger.error(err);
  const details =
    known && err.details && typeof err.details === 'object' ? (err.details as Record<string, unknown>) : {};
  const current = await prisma.job.findUnique({ where: { id: jobId } });
  if (!current || isTerminal(current.status)) return;
  const message = known ? err.message : 'Unexpected processing error';
  await jobs.transition(jobId, 'failed', {
    errorCode: known ? err.code : 'internal_error',
    errorMessage: message,
    message,
    diagnostics: details,
  });
}

// Connection-level Prisma errors (pool timeout, unreachable/closed server): worth retrying, not failing a job.
const TRANSIENT_DB_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

export function isTransient(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && TRANSIENT_DB_CODES.has(err.code);
}
