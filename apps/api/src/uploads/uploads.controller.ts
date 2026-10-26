import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type SessionUser } from '../auth/auth.guard';
import { UuidPipe } from '../common/uuid.pipe';
import { StorageService } from '../storage/storage.service';
import { SingleUploadInterceptor } from './upload.interceptor';
import { UploadsService } from './uploads.service';

@ApiTags('uploads')
@Controller('projects/:projectId/uploads')
export class UploadsController {
  constructor(
    private uploads: UploadsService,
    private storage: StorageService,
  ) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(SingleUploadInterceptor)
  create(
    @CurrentUser() user: SessionUser,
    @Param('projectId', new UuidPipe('Project')) projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.uploads.accept(user.id, projectId, file);
  }

  @Get()
  list(@CurrentUser() user: SessionUser, @Param('projectId', new UuidPipe('Project')) projectId: string) {
    return this.uploads.list(user.id, projectId);
  }

  @Get(':uploadId/thumbnail')
  async thumbnail(
    @CurrentUser() user: SessionUser,
    @Param('projectId', new UuidPipe('Project')) projectId: string,
    @Param('uploadId', new UuidPipe('Upload')) uploadId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const upload = await this.uploads.getOwned(user.id, projectId, uploadId);
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    return new StreamableFile(this.storage.read((upload.metadata as { thumbnailKey: string }).thumbnailKey), {
      type: 'image/webp',
    });
  }

  @Get(':uploadId/file')
  async file(
    @CurrentUser() user: SessionUser,
    @Param('projectId', new UuidPipe('Project')) projectId: string,
    @Param('uploadId', new UuidPipe('Upload')) uploadId: string,
  ) {
    const upload = await this.uploads.getOwned(user.id, projectId, uploadId);
    return new StreamableFile(this.storage.read(upload.storageKey), {
      type: upload.contentType,
      length: upload.sizeBytes,
    });
  }

  @Delete(':uploadId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: SessionUser,
    @Param('projectId', new UuidPipe('Project')) projectId: string,
    @Param('uploadId', new UuidPipe('Upload')) uploadId: string,
  ) {
    return this.uploads.remove(user.id, projectId, uploadId);
  }
}
