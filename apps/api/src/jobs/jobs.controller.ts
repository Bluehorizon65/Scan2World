import { Body, Controller, Get, HttpCode, MessageEvent, Param, Post, Sse } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Job } from '@prisma/client';
import { Observable } from 'rxjs';
import { CurrentUser, type SessionUser } from '../auth/auth.guard';
import { AppError } from '../common/app-error';
import { UuidPipe } from '../common/uuid.pipe';
import { env } from '../env';
import { PrismaService } from '../prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RedisService } from '../redis.service';
import { StorageService } from '../storage/storage.service';
import { ReconstructionConfigDto } from './jobs.dto';
import { jobChannel, JobsService } from './jobs.service';
import { isTerminal } from './state-machine';

const jobLimit = () => ({ default: { limit: Number(process.env.JOB_RATE_LIMIT ?? 20), ttl: 60_000 } });

@ApiTags('jobs')
@Controller()
export class JobsController {
  constructor(
    private jobs: JobsService,
    private projects: ProjectsService,
    private prisma: PrismaService,
    private redis: RedisService,
    private storage: StorageService,
  ) {}

  @Post('projects/:projectId/jobs/reconstruction')
  @Throttle(jobLimit())
  async createReconstruction(
    @CurrentUser() user: SessionUser,
    @Param('projectId', new UuidPipe('Project')) projectId: string,
    @Body() config: ReconstructionConfigDto,
  ) {
    await this.projects.getOwned(user.id, projectId);
    const images = await this.prisma.upload.count({ where: { projectId } });
    if (images < env.minImages)
      throw new AppError(
        409,
        'not_enough_images',
        `Reconstruction needs at least ${env.minImages} photos (this project has ${images})`,
      );
    const active = await this.prisma.job.count({
      where: { projectId, kind: 'reconstruction', status: { notIn: ['completed', 'failed', 'cancelled'] } },
    });
    if (active) throw new AppError(409, 'job_in_progress', 'A reconstruction is already running for this project');
    await this.storage.assertFreeSpace();
    return this.jobs.create(projectId, 'reconstruction', { ...config });
  }

  @Get('projects/:projectId/jobs')
  async list(@CurrentUser() user: SessionUser, @Param('projectId', new UuidPipe('Project')) projectId: string) {
    await this.projects.getOwned(user.id, projectId);
    return { items: await this.jobs.listForProject(projectId) };
  }

  @Get('jobs/:jobId')
  get(@CurrentUser() user: SessionUser, @Param('jobId', new UuidPipe('Job')) jobId: string) {
    return this.jobs.getOwned(user.id, jobId);
  }

  @Post('jobs/:jobId/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: SessionUser, @Param('jobId', new UuidPipe('Job')) jobId: string) {
    return this.jobs.cancel(user.id, jobId);
  }

  @Post('jobs/:jobId/retry')
  @Throttle(jobLimit())
  retry(@CurrentUser() user: SessionUser, @Param('jobId', new UuidPipe('Job')) jobId: string) {
    return this.jobs.retry(user.id, jobId);
  }

  /** Last ~64 KB of the processing log (COLMAP output), for diagnostics in the UI. */
  @Get('jobs/:jobId/log')
  async log(@CurrentUser() user: SessionUser, @Param('jobId', new UuidPipe('Job')) jobId: string) {
    const job = await this.jobs.getOwned(user.id, jobId);
    const key = `projects/${job.projectId}/jobs/${job.id}/job.log`;
    const size = await this.storage.size(key);
    if (size === null) return { log: '', truncated: false };
    const start = Math.max(0, size - 65_536);
    const chunks: Buffer[] = [];
    for await (const c of this.storage.read(key, start)) chunks.push(c as Buffer);
    return { log: Buffer.concat(chunks).toString('utf8'), truncated: start > 0 };
  }

  /** Server-sent events: a snapshot, then every change until the job reaches a terminal state. */
  @Sse('jobs/:jobId/events')
  async events(
    @CurrentUser() user: SessionUser,
    @Param('jobId', new UuidPipe('Job')) jobId: string,
  ): Promise<Observable<MessageEvent>> {
    const snapshot = await this.jobs.getOwned(user.id, jobId);
    return new Observable<MessageEvent>((sub) => {
      const subscriber = this.redis.client.duplicate();
      const send = (job: Job) => {
        sub.next({ data: job });
        if (isTerminal(job.status)) sub.complete();
      };
      subscriber.on('message', (_ch: string, msg: string) => send(JSON.parse(msg) as Job));
      void subscriber.subscribe(jobChannel(jobId)).then(async () => {
        // re-read after subscribing so a change between snapshot and subscribe isn't lost
        const fresh = await this.prisma.job.findUnique({ where: { id: jobId } });
        send(fresh ?? snapshot);
      });
      return () => subscriber.disconnect();
    });
  }
}
