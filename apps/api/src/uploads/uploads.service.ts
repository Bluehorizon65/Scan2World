import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import sharp from 'sharp';
import { AppError, notFound } from '../common/app-error';
import { env } from '../env';
import { PrismaService } from '../prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { detectImageType, IMAGE_MIME } from '../storage/image-type';
import { StorageService } from '../storage/storage.service';

const THUMB_PX = 320;

const publicFields = {
  id: true,
  projectId: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  sha256: true,
  width: true,
  height: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.UploadSelect;

async function sha256File(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function readHead(path: string, bytes = 16) {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

@Injectable()
export class UploadsService {
  constructor(
    private prisma: PrismaService,
    private projects: ProjectsService,
    private storage: StorageService,
  ) {}

  /** Validates and stores one uploaded temp file. The temp file is always consumed or deleted. */
  async accept(userId: string, projectId: string, file: Express.Multer.File) {
    const keys: string[] = [];
    try {
      await this.projects.getOwned(userId, projectId);
      await this.storage.assertFreeSpace();
      if ((await this.prisma.upload.count({ where: { projectId } })) >= env.maxImages)
        throw new AppError(409, 'upload_limit', `A project can hold at most ${env.maxImages} images`);

      const type = detectImageType(await readHead(file.path));
      if (!type) throw new AppError(415, 'unsupported_file_type', 'Only JPEG, PNG or WebP images are supported');

      let meta: sharp.Metadata;
      const id = randomUUID();
      const thumbKey = `projects/${projectId}/uploads/${id}.thumb.webp`;
      try {
        meta = await sharp(file.path, { failOn: 'error' }).metadata();
        await sharp(file.path, { failOn: 'error' })
          .rotate()
          .resize(THUMB_PX, THUMB_PX, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 72 })
          .toFile(await this.storage.prepare(thumbKey));
      } catch {
        await this.storage.remove(thumbKey);
        throw new AppError(415, 'unreadable_image', 'The image could not be decoded; it may be corrupt or truncated');
      }
      keys.push(thumbKey);

      const sha256 = await sha256File(file.path);
      if (await this.prisma.upload.findUnique({ where: { projectId_sha256: { projectId, sha256 } } }))
        throw new AppError(409, 'duplicate_upload', 'This exact image is already in the project');

      const storageKey = `projects/${projectId}/uploads/${id}.${type === 'jpeg' ? 'jpg' : type}`;
      await this.storage.moveIn(file.path, storageKey);
      keys.push(storageKey);
      try {
        return await this.prisma.upload.create({
          data: {
            id,
            projectId,
            storageKey,
            sha256,
            fileName: file.originalname.slice(0, 255),
            contentType: IMAGE_MIME[type],
            sizeBytes: file.size,
            width: meta.width ?? 0,
            height: meta.height ?? 0,
            metadata: { thumbnailKey: thumbKey, orientation: meta.orientation ?? 1 },
          },
          select: publicFields,
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
          throw new AppError(409, 'duplicate_upload', 'This exact image is already in the project');
        throw e;
      }
    } catch (e) {
      await Promise.all(keys.map((k) => this.storage.remove(k)));
      throw e;
    } finally {
      await rm(file.path, { force: true });
    }
  }

  async list(userId: string, projectId: string) {
    await this.projects.getOwned(userId, projectId);
    const items = await this.prisma.upload.findMany({
      where: { projectId },
      select: publicFields,
      orderBy: { createdAt: 'asc' },
    });
    return { items };
  }

  async getOwned(userId: string, projectId: string, uploadId: string) {
    await this.projects.getOwned(userId, projectId);
    const upload = await this.prisma.upload.findFirst({ where: { id: uploadId, projectId } });
    if (!upload) throw notFound('Upload');
    return upload;
  }

  async remove(userId: string, projectId: string, uploadId: string) {
    const upload = await this.getOwned(userId, projectId, uploadId);
    await this.prisma.upload.delete({ where: { id: upload.id } });
    await this.storage.remove(upload.storageKey);
    await this.storage.remove((upload.metadata as { thumbnailKey: string }).thumbnailKey);
  }
}
