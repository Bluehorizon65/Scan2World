import { Logger } from '@nestjs/common';
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
