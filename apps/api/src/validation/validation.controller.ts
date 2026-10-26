import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type SessionUser } from '../auth/auth.guard';
import { AppError } from '../common/app-error';
import { UuidPipe } from '../common/uuid.pipe';
import { PythonClient } from '../internal/python-client';
import { PrismaService } from '../prisma.service';
import { ProjectsService } from '../projects/projects.service';

interface VisionImage {
  key: string;
  readable: boolean;
  blur: number;
  brightness: number;
  contrast: number;
  keypoints: number;
  issues: string[];
}
interface VisionResponse {
  images: VisionImage[];
  dataset: { duplicateGroups: string[][]; [k: string]: unknown };
}

@ApiTags('uploads')
@Controller('projects/:projectId/validate')
export class ValidationController {
  constructor(
    private prisma: PrismaService,
    private projects: ProjectsService,
    private python: PythonClient,
  ) {}

  /** Runs capture-quality analysis on every upload; results are stored and returned keyed by upload id. */
  @Post()
  @HttpCode(200)
  async validate(@CurrentUser() user: SessionUser, @Param('projectId', new UuidPipe('Project')) projectId: string) {
    await this.projects.getOwned(user.id, projectId);
    const uploads = await this.prisma.upload.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    if (!uploads.length) throw new AppError(409, 'no_uploads', 'Upload photos before validating');

    const result = await this.python.call<VisionResponse>(
      'vision',
      'POST',
      '/analyze',
      {
        keys: uploads.map((u) => u.storageKey),
      },
      { timeoutMs: 300_000 },
    );

    const byKey = new Map(uploads.map((u) => [u.storageKey, u]));
    const images = result.images.flatMap(({ key, ...quality }) => {
      const upload = byKey.get(key);
      return upload ? [{ uploadId: upload.id, fileName: upload.fileName, ...quality }] : [];
    });
    const dataset = {
      ...result.dataset,
      duplicateGroups: result.dataset.duplicateGroups.map((g) => g.flatMap((k) => byKey.get(k)?.id ?? [])),
      validatedAt: new Date().toISOString(),
    };

    await this.prisma.$transaction([
      ...images.map(({ uploadId, fileName: _f, ...quality }) => {
        const upload = uploads.find((u) => u.id === uploadId)!;
        return this.prisma.upload.update({
          where: { id: uploadId },
          data: { metadata: { ...(upload.metadata as object), quality } },
        });
      }),
      this.prisma.project.update({ where: { id: projectId }, data: { validation: dataset } }),
    ]);
    return { dataset, images };
  }
}
