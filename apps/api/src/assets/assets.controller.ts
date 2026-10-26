import { Body, Controller, Get, Module, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JobKind } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type SessionUser } from '../auth/auth.guard';
import { AppError } from '../common/app-error';
import { UuidPipe } from '../common/uuid.pipe';
import { JobsService } from '../jobs/jobs.service';
import { ProjectsService } from '../projects/projects.service';
import { StorageService } from '../storage/storage.service';
import { AssetsCoreModule, AssetsService, publicAsset } from './assets.service';
import { ExportDto, GamemapDto, ProcessDto } from './geometry-jobs.dto';

const jobLimit = () => ({ default: { limit: Number(process.env.JOB_RATE_LIMIT ?? 20), ttl: 60_000 } });

const MIME: Record<string, string> = {
  glb: 'model/gltf-binary',
  ply: 'application/octet-stream',
  obj: 'model/obj',
  zip: 'application/zip',
  json: 'application/json',
};

@ApiTags('assets')
@Controller()
export class AssetsController {
  constructor(
    private assets: AssetsService,
    private projects: ProjectsService,
    private storage: StorageService,
    private jobs: JobsService,
  ) {}

  /** Creates a geometry job on an owned mesh asset; the source file is never modified. */
  private async meshJob(userId: string, assetId: string, kind: JobKind, configuration: object) {
    const asset = await this.assets.getOwned(userId, assetId);
    if (!['mesh_visual', 'mesh_collision'].includes(asset.assetType) || asset.format !== 'glb')
      throw new AppError(409, 'not_a_mesh', 'This operation needs a mesh asset (GLB)');
    await this.storage.assertFreeSpace();
    return this.jobs.create(asset.projectId, kind, configuration, asset.id);
  }

  @Post('assets/:assetId/process')
  @Throttle(jobLimit())
  process(
    @CurrentUser() user: SessionUser,
    @Param('assetId', new UuidPipe('Asset')) assetId: string,
    @Body() dto: ProcessDto,
  ) {
    return this.meshJob(user.id, assetId, 'processing', { ops: dto.ops });
  }

  @Post('assets/:assetId/gamemap')
  @Throttle(jobLimit())
  gamemap(
    @CurrentUser() user: SessionUser,
    @Param('assetId', new UuidPipe('Asset')) assetId: string,
    @Body() dto: GamemapDto,
  ) {
    return this.meshJob(user.id, assetId, 'gamemap', { ...dto });
  }

  @Post('assets/:assetId/export')
  @Throttle(jobLimit())
  export(
    @CurrentUser() user: SessionUser,
    @Param('assetId', new UuidPipe('Asset')) assetId: string,
    @Body() dto: ExportDto,
  ) {
    return this.meshJob(user.id, assetId, 'export', { ...dto, formats: [...new Set(dto.formats)] });
  }

  @Get('projects/:projectId/assets')
  async list(@CurrentUser() user: SessionUser, @Param('projectId', new UuidPipe('Project')) projectId: string) {
    await this.projects.getOwned(user.id, projectId);
    return { items: (await this.assets.list(projectId)).map(publicAsset) };
  }

  @Get('assets/:assetId')
  async get(@CurrentUser() user: SessionUser, @Param('assetId', new UuidPipe('Asset')) assetId: string) {
    return publicAsset(await this.assets.getOwned(user.id, assetId));
  }

  /** Owner-checked streamed download; `inline` variant is what the 3D viewer loads. */
  @Get('assets/:assetId/download')
  async download(
    @CurrentUser() user: SessionUser,
    @Param('assetId', new UuidPipe('Asset')) assetId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const asset = await this.assets.getOwned(user.id, assetId);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const filename = `${asset.name.replace(/[^\w.-]+/g, '_')}.${asset.format}`;
    return new StreamableFile(this.storage.read(asset.storageKey), {
      type: MIME[asset.format] ?? 'application/octet-stream',
      length: asset.sizeBytes,
      disposition: `attachment; filename="${filename}"`,
    });
  }
}

@Module({ imports: [AssetsCoreModule], controllers: [AssetsController] })
export class AssetsModule {}
