import { Controller, Get, Module, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type SessionUser } from '../auth/auth.guard';
import { UuidPipe } from '../common/uuid.pipe';
import { ProjectsService } from '../projects/projects.service';
import { StorageService } from '../storage/storage.service';
import { AssetsCoreModule, AssetsService, publicAsset } from './assets.service';

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
  ) {}

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
