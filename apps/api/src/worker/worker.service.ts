import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { JobKind } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { bullConnection, QueuePayload } from '../jobs/queues';
import { JobsService } from '../jobs/jobs.service';
import { isTerminal } from '../jobs/state-machine';
import { PrismaService } from '../prisma.service';
import { GeometryRunner } from './geometry.runner';
import { ReconstructionRunner } from './reconstruction.runner';

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private workers: Worker<QueuePayload>[] = [];

  constructor(
    private prisma: PrismaService,
    private jobs: JobsService,
    private recon: ReconstructionRunner,
    private geometry: GeometryRunner,
  ) {}

  async onApplicationBootstrap() {
    await this.recoverOrphans();
    const common = { connection: bullConnection(), lockDuration: 60_000, maxStalledCount: 2 };
    this.workers = [
      new Worker<QueuePayload>('reconstruction', (j) => this.recon.run(j.data.jobId), {
        ...common,
        concurrency: Number(process.env.RECON_CONCURRENCY ?? 1),
      }),
      new Worker<QueuePayload>('geometry', (j) => this.geometry.run(j.data.jobId, j.name as JobKind), {
        ...common,
        concurrency: Number(process.env.GEOMETRY_CONCURRENCY ?? 2),
      }),
    ];
    for (const w of this.workers) {
      // Safety net: BullMQ gave up (e.g. stalled too often) but the DB still says the job is live.
      w.on('failed', (j, err) => {
        if (j) void this.markLost(j.data.jobId, err.message);
      });
      w.on('error', (err) => this.logger.error(`queue ${w.name}: ${err.message}`));
    }
    this.logger.log('Worker started');
  }

  async onApplicationShutdown() {
    // Lets active jobs keep their DB state; BullMQ re-delivers them to the next worker as stalled jobs.
    await Promise.all(this.workers.map((w) => w.close()));
  }

  /** DB jobs that are live but unknown to the queue (e.g. Redis was wiped) can never progress: fail them. */
  private async recoverOrphans() {
    const live = await this.prisma.job.findMany({ where: { status: { notIn: ['completed', 'failed', 'cancelled'] } } });
    const queues = {
      reconstruction: new Queue('reconstruction', { connection: bullConnection() }),
      geometry: new Queue('geometry', { connection: bullConnection() }),
    };
    try {
      for (const job of live) {
        const q = job.kind === 'reconstruction' ? queues.reconstruction : queues.geometry;
        const state = await (await q.getJob(job.id))?.getState();
        if (!state || state === 'completed' || state === 'failed' || state === 'unknown')
          await this.markLost(job.id, `queue state ${state ?? 'missing'}`);
      }
    } finally {
      await Promise.all(Object.values(queues).map((q) => q.close()));
    }
  }

  private async markLost(jobId: string, reason: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || isTerminal(job.status)) return;
    this.logger.warn(`job ${jobId} lost: ${reason}`);
    if (job.status === 'cancelling')
      await this.jobs.transition(jobId, 'cancelled', { message: 'Cancelled (worker restarted)' });
    else
      await this.jobs.transition(jobId, 'failed', {
        errorCode: 'worker_lost',
        errorMessage: 'Processing was interrupted and could not be resumed; retry the job',
        message: `Worker lost the job (${reason})`,
      });
  }
}
