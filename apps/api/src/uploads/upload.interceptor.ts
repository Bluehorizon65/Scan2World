import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { AppError } from '../common/app-error';
import { env } from '../env';
import { StorageService } from '../storage/storage.service';

/** Streams a single `file` field to DATA_DIR/tmp with limits read per request (so they follow env). */
@Injectable()
export class SingleUploadInterceptor implements NestInterceptor {
  constructor(private storage: StorageService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const dir = this.storage.tmpDir();
    mkdirSync(dir, { recursive: true });
    const upload = multer({
      storage: multer.diskStorage({ destination: dir, filename: (_r, _f, cb) => cb(null, randomUUID()) }),
      limits: { fileSize: env.maxFileBytes, files: 1, fields: 5 },
    }).single('file');
    await new Promise<void>((resolve, reject) =>
      upload(req, res, (err: unknown) => {
        if (!err) return resolve();
        if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE')
          return reject(
            new AppError(413, 'file_too_large', `Files must be at most ${process.env.MAX_FILE_MB ?? 40} MB`),
          );
        if (err instanceof MulterError) return reject(new AppError(400, 'bad_upload', err.message));
        reject(err instanceof Error ? err : new Error('upload failed'));
      }),
    );
    if (!req.file) throw new AppError(400, 'bad_upload', 'Expected one file in the "file" field');
    return next.handle();
  }
}
