import { Injectable, Logger } from '@nestjs/common';
import { Job } from '@prisma/client';
import { AssetsService } from '../assets/assets.service';
import { AppError } from '../common/app-error';
import { env } from '../env';
import { PythonClient } from '../internal/python-client';
import { JobsService } from '../jobs/jobs.service';
import { isTerminal } from '../jobs/state-machine';
import { PrismaService } from '../prisma.service';
import { StorageService } from '../storage/storage.service';
import { failJob } from './job-failure';
import { ShutdownError, WorkerLifecycle } from './lifecycle';

interface ReconConfig {
  quality: 'draft' | 'balanced' | 'high';
  matcher: 'exhaustive' | 'sequential';
  dense: boolean;
}

interface ReconStatus {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  stage?: string;
  gpu?: boolean;
  dense?: boolean;
  progress?: { label: string; current: number; total: number } | null;
  error?: { code: string; message: string; advice?: string[] };
  outputs?: { sparse_ply?: string; dense_ply?: string };
  stats?: Record<string, unknown>;
}

const TIMEOUT_MIN: Record<ReconConfig['quality'], number> = { draft: 45, balanced: 180, high: 480 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Thrown to stop the pipeline after the job has already been moved to a terminal state. */
class Stopped extends Error {}

/**
 * Drives one reconstruction job: validation -> COLMAP (recon service) -> meshing + validation (geometry service).
 * Re-entrant: after a worker restart it resumes from the persisted status, re-attaching to the python job.
 */
@Injectable()
export class ReconstructionRunner {
  private readonly logger = new Logger(ReconstructionRunner.name);

  constructor(
    private prisma: PrismaService,
    private jobs: JobsService,
    private python: PythonClient,
    private assets: AssetsService,
    private storage: StorageService,
    private lifecycle: WorkerLifecycle,
  ) {}

  async run(jobId: string) {
    let job = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    if (isTerminal(job.status)) return;
    try {
      if (job.status === 'cancelling') return await this.finishCancel(job);
      if (job.status === 'queued')
        job = await this.jobs.transition(jobId, 'validating', {
          stage: 'validation',
          message: 'Checking photos and disk space',
        });
      if (job.status === 'validating') job = await this.validate(job);
      if (job.status === 'running') job = await this.colmap(job);
      if (job.status === 'processing') await this.meshAndRegister(job);
    } catch (err) {
      if (err instanceof Stopped) return;
      // Errors caused by shutdown (closed connections etc.) must not fail the job; the next worker resumes it.
      if (err instanceof ShutdownError || this.lifecycle.stopping) throw new ShutdownError();
      await failJob(this.prisma, this.jobs, jobId, err);
    }
  }

  private async validate(job: Job) {
    const uploads = await this.prisma.upload.findMany({
      where: { projectId: job.projectId },
      select: { storageKey: true },
    });
    if (uploads.length < env.minImages)
      throw new AppError(409, 'not_enough_images', `At least ${env.minImages} photos are required`);
    const missing = (await Promise.all(uploads.map((u) => this.storage.size(u.storageKey)))).filter(
      (s) => s === null,
    ).length;
    if (missing) throw new AppError(500, 'missing_uploads', `${missing} uploaded file(s) are missing from storage`);
    await this.storage.assertFreeSpace();
    return this.jobs.transition(job.id, 'running', {
      stage: 'feature_extraction',
      message: `Starting COLMAP on ${uploads.length} photos`,
    });
  }

  private async colmap(job: Job): Promise<Job> {
    const cfg = job.configuration as unknown as ReconConfig;
    const uploads = await this.prisma.upload.findMany({
      where: { projectId: job.projectId },
      orderBy: { createdAt: 'asc' },
    });
    // Idempotent on the python side: an existing job with this id is re-attached, not restarted.
    await this.python.call('recon', 'POST', `/jobs/${job.id}`, {
      imageKeys: uploads.map((u) => u.storageKey),
      outputPrefix: `projects/${job.projectId}/jobs/${job.id}`,
      quality: cfg.quality,
      matcher: cfg.matcher,
      dense: cfg.dense,
      // one camera model for all photos only when they share a resolution (likely the same device)
      singleCamera: new Set(uploads.map((u) => `${u.width}x${u.height}`)).size === 1,
    });

    const deadline =
      (job.startedAt ?? new Date()).getTime() +
      Number(process.env.RECON_TIMEOUT_MIN ?? TIMEOUT_MIN[cfg.quality]) * 60_000;
    let lastProgress = '';
    for (;;) {
      await sleep(env.pollMs);
      if (this.lifecycle.stopping) throw new ShutdownError();
      await this.checkCancelled(job.id);
      if (Date.now() > deadline) {
        await this.python.call('recon', 'DELETE', `/jobs/${job.id}`).catch(() => undefined);
        throw new AppError(504, 'timeout', 'Reconstruction exceeded its time limit; try draft quality or fewer photos');
      }
      const s = await this.python.call<ReconStatus>('recon', 'GET', `/jobs/${job.id}`);
      if (s.status === 'failed') {
        throw new AppError(422, s.error?.code ?? 'reconstruction_failed', s.error?.message ?? 'Reconstruction failed', {
          advice: s.error?.advice ?? [],
          stage: s.stage,
        });
      }
      if (s.status === 'cancelled')
        throw new AppError(500, 'recon_cancelled', 'The reconstruction service cancelled the job');
      if (s.stage && s.stage !== job.stage) {
        job = await this.jobs.transition(job.id, 'running', {
          stage: s.stage,
          progress: s.progress ?? null,
          diagnostics: { gpu: s.gpu, dense: s.dense },
        });
      } else if (s.progress && JSON.stringify(s.progress) !== lastProgress) {
        await this.jobs.setProgress(job.id, s.progress);
      }
      lastProgress = JSON.stringify(s.progress ?? '');
      if (s.status === 'completed') {
        return this.jobs.transition(job.id, 'processing', {
          stage: 'meshing',
          progress: null,
          message: s.dense ? 'Meshing the dense point cloud' : 'Meshing the sparse point cloud (no GPU: low detail)',
          diagnostics: { gpu: s.gpu, dense: s.dense, stats: s.stats, outputs: s.outputs },
        });
      }
    }
  }

  private async meshAndRegister(job: Job) {
    const outputs = (job.diagnostics as { outputs?: ReconStatus['outputs'] }).outputs ?? {};
    const source = outputs.dense_ply ?? outputs.sparse_ply;
    if (!source) throw new AppError(500, 'missing_output', 'Reconstruction produced no point cloud');
    const prefix = `projects/${job.projectId}/jobs/${job.id}`;
    const mesh = await this.python.call<{
      outputs: { mesh_glb: string; points_ply?: string };
      stats: Record<string, unknown>;
    }>(
      'geometry',
      'POST',
      '/mesh',
      { sourceKey: source, outputPrefix: prefix, dense: Boolean(outputs.dense_ply) },
      { timeoutMs: 3_600_000 },
    );
    await this.checkCancelled(job.id);
    job = await this.jobs.transition(job.id, 'processing', {
      stage: 'export_validation',
      message: 'Validating outputs',
    });

    const registered = [];
    const base = { projectId: job.projectId, jobId: job.id };
    // The cloud that was meshed is registered in its outlier-filtered form (stray SfM points removed);
    // the raw COLMAP output stays untouched in the job folder.
    const filtered = mesh.outputs.points_ply
      ? { storageKey: mesh.outputs.points_ply, extra: { filtered: true, outliersRemoved: mesh.stats.outliersRemoved } }
      : undefined;
    const cloud = (key: string, meshed: boolean) => (meshed && filtered ? filtered : { storageKey: key, extra: {} });
    if (outputs.sparse_ply)
      registered.push(
        await this.registerOnce({
          ...base,
          ...cloud(outputs.sparse_ply, !outputs.dense_ply),
          assetType: 'point_cloud_sparse',
          name: 'Sparse point cloud',
        }),
      );
    if (outputs.dense_ply)
      registered.push(
        await this.registerOnce({
          ...base,
          ...cloud(outputs.dense_ply, true),
          assetType: 'point_cloud_dense',
          name: 'Dense point cloud',
        }),
      );
    registered.push(
      await this.registerOnce({
        ...base,
        storageKey: mesh.outputs.mesh_glb,
        assetType: 'mesh_visual',
        name: 'Reconstructed mesh',
        extra: { meshing: mesh.stats, lowDetail: !outputs.dense_ply },
      }),
    );
    await this.prisma.project.update({ where: { id: job.projectId }, data: { status: 'reconstructed' } });
    await this.jobs.transition(job.id, 'completed', {
      message: 'Reconstruction complete',
      resultManifest: { assets: registered.map((a) => ({ id: a.id, type: a.assetType })) },
    });
  }

  private async registerOnce(input: Parameters<AssetsService['register']>[0]) {
    const existing = await this.prisma.asset.findUnique({ where: { storageKey: input.storageKey } });
    return existing ?? this.assets.register(input);
  }

  private async checkCancelled(jobId: string) {
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status === 'cancelling') {
      await this.finishCancel(job);
      throw new Stopped();
    }
    if (isTerminal(job.status)) throw new Stopped();
  }

  private async finishCancel(job: Job) {
    if (job.kind === 'reconstruction')
      await this.python
        .call('recon', 'DELETE', `/jobs/${job.id}`)
        .catch((e: unknown) => this.logger.warn(`cancel: ${String(e)}`));
    await this.jobs.transition(job.id, 'cancelled', { message: 'Cancelled' });
  }
}
