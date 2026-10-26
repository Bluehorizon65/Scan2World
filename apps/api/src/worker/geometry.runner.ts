import { Injectable } from '@nestjs/common';
import { Asset, Job, JobKind } from '@prisma/client';
import { AssetsService } from '../assets/assets.service';
import { AppError } from '../common/app-error';
import { PythonClient } from '../internal/python-client';
import { JobsService } from '../jobs/jobs.service';
import { isTerminal } from '../jobs/state-machine';
import { PrismaService } from '../prisma.service';
import { StorageService } from '../storage/storage.service';
import { failJob } from './job-failure';

interface MeshMeta {
  aligned?: boolean;
  scaled?: boolean;
  reconJobId?: string;
}

const STAGE: Record<Exclude<JobKind, 'reconstruction'>, string> = {
  processing: 'mesh_processing',
  gamemap: 'gamemap_preparation',
  export: 'export_packaging',
};
const TIMEOUT_MS = 3_600_000;

/** Processing, game-map and export jobs: one synchronous geometry-service call, then validated asset registration. */
@Injectable()
export class GeometryRunner {
  constructor(
    private prisma: PrismaService,
    private jobs: JobsService,
    private python: PythonClient,
    private assets: AssetsService,
    private storage: StorageService,
  ) {}

  async run(jobId: string, kind: JobKind) {
    let job = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    if (isTerminal(job.status)) return;
    if (job.status === 'cancelling') {
      await this.jobs.transition(jobId, 'cancelled', { message: 'Cancelled' });
      return;
    }
    try {
      const source = await this.prisma.asset.findUnique({ where: { id: job.sourceAssetId ?? '' } });
      if (!source) throw new AppError(409, 'source_missing', 'The source asset no longer exists');
      if (job.status === 'queued') job = await this.jobs.transition(jobId, 'validating', { stage: 'validation' });
      if (job.status === 'validating') {
        await this.storage.assertFreeSpace();
        job = await this.jobs.transition(jobId, 'running', { stage: STAGE[kind as keyof typeof STAGE] });
      }
      // Re-entry after a worker restart in 'running'/'processing' simply redoes the call; outputs are keyed by job id.
      if (kind === 'processing') await this.process(job, source);
      else if (kind === 'gamemap') await this.gamemap(job, source);
      else if (kind === 'export') await this.export(job, source);
    } catch (err) {
      await failJob(this.prisma, this.jobs, jobId, err);
    }
  }

  private prefix(job: Job) {
    return `projects/${job.projectId}/jobs/${job.id}`;
  }

  private lineage(source: Asset) {
    const meta = source.metadata as MeshMeta;
    return { meta, reconJobId: meta.reconJobId ?? source.jobId ?? undefined };
  }

  private async camerasKey(source: Asset) {
    const { reconJobId } = this.lineage(source);
    const key = reconJobId && `projects/${source.projectId}/jobs/${reconJobId}/cameras.json`;
    return key && (await this.storage.size(key)) !== null ? key : undefined;
  }

  /** Returns false (and finalises the cancel) if the user cancelled while the geometry call was running. */
  private async finish(job: Job) {
    const current = await this.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    if (current.status === 'cancelling') {
      await this.jobs.transition(job.id, 'cancelled', { message: 'Cancelled (results discarded)' });
      return false;
    }
    await this.jobs.transition(job.id, 'processing', { stage: 'export_validation', message: 'Validating outputs' });
    return true;
  }

  private async registerOnce(input: Parameters<AssetsService['register']>[0]) {
    return (
      (await this.prisma.asset.findUnique({ where: { storageKey: input.storageKey } })) ?? this.assets.register(input)
    );
  }

  private async process(job: Job, source: Asset) {
    const ops = (job.configuration as { ops: { op: string }[] }).ops;
    const { meta, reconJobId } = this.lineage(source);
    const res = await this.python.call<{
      outputs: { mesh_glb: string };
      report: { steps: unknown[]; aligned: boolean };
    }>(
      'geometry',
      'POST',
      '/process',
      { sourceKey: source.storageKey, outputPrefix: this.prefix(job), ops, camerasKey: await this.camerasKey(source) },
      { timeoutMs: TIMEOUT_MS },
    );
    if (!(await this.finish(job))) return;
    const asset = await this.registerOnce({
      projectId: job.projectId,
      jobId: job.id,
      parentAssetId: source.id,
      storageKey: res.outputs.mesh_glb,
      assetType: 'mesh_visual',
      name: 'Processed mesh',
      extra: {
        ops: res.report.steps,
        aligned: res.report.aligned || !!meta.aligned,
        scaled: !!meta.scaled || ops.some((o) => o.op === 'scale'),
        reconJobId,
      },
    });
    await this.jobs.transition(job.id, 'completed', {
      message: 'Processing complete',
      resultManifest: { assets: [{ id: asset.id, type: asset.assetType }], report: res.report },
    });
  }

  private async gamemap(job: Job, source: Asset) {
    const cfg = job.configuration as { collisionTargetTriangles: number; maxSlopeDeg: number };
    const { meta, reconJobId } = this.lineage(source);
    const res = await this.python.call<{
      outputs: { visual_glb: string; collision_glb: string; walkable_glb?: string; report_json: string };
      report: Record<string, unknown>;
    }>(
      'geometry',
      'POST',
      '/gamemap',
      {
        sourceKey: source.storageKey,
        outputPrefix: this.prefix(job),
        ...cfg,
        align: !meta.aligned,
        scaled: !!meta.scaled,
        camerasKey: await this.camerasKey(source),
      },
      { timeoutMs: TIMEOUT_MS },
    );
    if (!(await this.finish(job))) return;
    const base = { projectId: job.projectId, jobId: job.id };
    const lineage = { aligned: true, scaled: !!meta.scaled, reconJobId };
    const visual = await this.registerOnce({
      ...base,
      parentAssetId: source.id,
      storageKey: res.outputs.visual_glb,
      assetType: 'mesh_visual',
      name: 'Game visual mesh',
      extra: { ...lineage, gamemap: true },
    });
    const children = [
      await this.registerOnce({
        ...base,
        parentAssetId: visual.id,
        storageKey: res.outputs.collision_glb,
        assetType: 'mesh_collision',
        name: 'Collision mesh',
        extra: lineage,
      }),
      ...(res.outputs.walkable_glb
        ? [
            await this.registerOnce({
              ...base,
              parentAssetId: visual.id,
              storageKey: res.outputs.walkable_glb,
              assetType: 'walkable',
              name: 'Candidate walkable surface',
              extra: lineage,
            }),
          ]
        : []),
      await this.registerOnce({
        ...base,
        parentAssetId: visual.id,
        storageKey: res.outputs.report_json,
        assetType: 'report',
        name: 'Game-map report',
        extra: { report: res.report },
      }),
    ];
    await this.jobs.transition(job.id, 'completed', {
      message: 'Game-map preparation complete',
      resultManifest: {
        assets: [visual, ...children].map((a) => ({ id: a.id, type: a.assetType })),
        report: res.report,
      },
    });
  }

  private async export(job: Job, source: Asset) {
    const cfg = job.configuration as { formats: string[]; includeCollision: boolean; includeWalkable: boolean };
    const { meta } = this.lineage(source);
    const latestChild = (type: 'mesh_collision' | 'walkable') =>
      this.prisma.asset.findFirst({
        where: { parentAssetId: source.id, assetType: type },
        orderBy: { createdAt: 'desc' },
      });
    const collision = cfg.includeCollision ? await latestChild('mesh_collision') : null;
    const walkable = cfg.includeWalkable ? await latestChild('walkable') : null;
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: job.projectId } });
    const settings = project.settings as { scaleFactor?: number };
    const sources = [
      { key: source.storageKey, role: 'visual' },
      ...(collision ? [{ key: collision.storageKey, role: 'collision' }] : []),
      ...(walkable ? [{ key: walkable.storageKey, role: 'walkable' }] : []),
    ];
    const res = await this.python.call<{ outputs: { package_zip: string }; manifest: Record<string, unknown> }>(
      'geometry',
      'POST',
      '/export',
      {
        sources,
        outputPrefix: this.prefix(job),
        formats: cfg.formats,
        metadata: {
          projectName: project.name,
          units: meta.scaled ? 'm' : 'unitless',
          scaleFactor: meta.scaled ? (settings.scaleFactor ?? null) : null,
        },
      },
      { timeoutMs: TIMEOUT_MS },
    );
    if (!(await this.finish(job))) return;
    const pkg = await this.registerOnce({
      projectId: job.projectId,
      jobId: job.id,
      parentAssetId: source.id,
      storageKey: res.outputs.package_zip,
      assetType: 'export_package',
      name: `${project.name} export`,
      extra: { manifest: res.manifest, formats: cfg.formats, roles: sources.map((s) => s.role) },
    });
    await this.jobs.transition(job.id, 'completed', {
      message: 'Export package ready',
      resultManifest: { assets: [{ id: pkg.id, type: pkg.assetType }], manifest: res.manifest },
    });
  }
}
