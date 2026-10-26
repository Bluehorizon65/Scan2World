import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, JobKind, JobStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { AppError, notFound } from '../common/app-error';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';
import { bullConnection, QUEUE_FOR, QueuePayload } from './queues';
import { assertTransition, isTerminal } from './state-machine';

export interface TransitionData {
  stage?: string | null;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
  diagnostics?: Record<string, unknown>;
  progress?: Record<string, unknown> | null;
  resultManifest?: Record<string, unknown>;
}

export const jobChannel = (jobId: string) => `job:${jobId}`;

@Injectable()
export class JobsService implements OnModuleDestroy {
  private queues = new Map<string, Queue<QueuePayload>>();

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  private queue(kind: JobKind) {
    const name = QUEUE_FOR[kind];
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue<QueuePayload>(name, { connection: bullConnection() });
      this.queues.set(name, q);
    }
    return q;
  }

  async onModuleDestroy() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }

  async create(projectId: string, kind: JobKind, configuration: object, sourceAssetId?: string) {
    const job = await this.prisma.job.create({
      data: {
        projectId,
        kind,
        sourceAssetId,
        configuration: configuration,
        events: { create: { status: 'queued', message: 'Job queued' } },
      },
    });
    // BullMQ job id = DB job id, so a duplicate enqueue of the same job is a no-op.
    await this.queue(kind).add(
      kind,
      { jobId: job.id },
      { jobId: job.id, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
    );
    await this.publish(job);
    return job;
  }

  /** Validated, race-safe status change: only applies if the status is still what we read. */
  async transition(jobId: string, to: JobStatus, data: TransitionData = {}): Promise<Job> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
      assertTransition(current.status, to);
      const stageChanged = data.stage !== undefined && data.stage !== current.stage;
      const { count } = await this.prisma.job.updateMany({
        where: { id: jobId, status: current.status },
        data: {
          status: to,
          ...(data.stage !== undefined ? { stage: data.stage } : {}),
          ...(data.errorCode ? { errorCode: data.errorCode, errorMessage: data.errorMessage ?? null } : {}),
          ...(data.diagnostics
            ? { diagnostics: { ...(current.diagnostics as object), ...data.diagnostics } as Prisma.InputJsonObject }
            : {}),
          ...(data.progress !== undefined
            ? { progress: (data.progress ?? Prisma.DbNull) as Prisma.InputJsonObject }
            : {}),
          ...(data.resultManifest ? { resultManifest: data.resultManifest as Prisma.InputJsonObject } : {}),
          ...(current.startedAt || ['queued', 'cancelled'].includes(to) ? {} : { startedAt: new Date() }),
          ...(isTerminal(to) ? { completedAt: new Date() } : {}),
        },
      });
      if (!count) continue; // status changed underneath us (e.g. user cancelled); re-read and re-validate
      if (to !== current.status || stageChanged || data.message)
        await this.prisma.jobEvent.create({
          data: { jobId, status: to, stage: data.stage ?? current.stage, message: data.message },
        });
      const job = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
      await this.publish(job);
      return job;
    }
    throw new AppError(409, 'job_conflict', 'Job state changed concurrently; try again');
  }

  /** Progress-only update (no status/event row), e.g. "12/30 images registered". */
  async setProgress(jobId: string, progress: Record<string, unknown>) {
    const job = await this.prisma.job.update({
      where: { id: jobId },
      data: { progress: progress as Prisma.InputJsonObject },
    });
    await this.publish(job);
  }

  async getOwned(userId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, project: { ownerId: userId } },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!job) throw notFound('Job');
    return job;
  }

  listForProject(projectId: string) {
    return this.prisma.job.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async cancel(userId: string, jobId: string) {
    const job = await this.getOwned(userId, jobId);
    if (isTerminal(job.status) || job.status === 'cancelling')
      throw new AppError(409, 'job_not_cancellable', `Job is already ${job.status}`);
    if (job.status === 'queued') {
      const removed = await this.queue(job.kind)
        .remove(job.id)
        .catch(() => 0);
      if (removed) return this.transition(job.id, 'cancelled', { message: 'Cancelled before start' });
    }
    // The worker sees `cancelling`, stops the python job and finishes the transition.
    return this.transition(job.id, 'cancelling', { message: 'Cancellation requested' });
  }

  async retry(userId: string, jobId: string) {
    const job = await this.getOwned(userId, jobId);
    if (!['failed', 'cancelled'].includes(job.status))
      throw new AppError(409, 'job_not_retryable', 'Only failed or cancelled jobs can be retried');
    return this.create(job.projectId, job.kind, job.configuration as object, job.sourceAssetId ?? undefined);
  }

  private async publish(job: Job) {
    await this.redis.client.publish(jobChannel(job.id), JSON.stringify(job));
  }
}
