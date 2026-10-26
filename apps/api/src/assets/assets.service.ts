import { Global, Injectable, Module } from '@nestjs/common';
import { Asset, AssetType } from '@prisma/client';
import { AppError, notFound } from '../common/app-error';
import { PythonClient } from '../internal/python-client';
import { PrismaService } from '../prisma.service';
import { StorageService } from '../storage/storage.service';

export const publicAsset = ({ storageKey: _k, ...asset }: Asset) => asset;

export interface Inspection {
  kind: 'mesh' | 'point_cloud';
  [stat: string]: unknown;
}

@Injectable()
export class AssetsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private python: PythonClient,
  ) {}

  /** Re-reads a produced file with the geometry service and records it only if it is valid. */
  async register(input: {
    projectId: string;
    jobId?: string;
    parentAssetId?: string | null;
    storageKey: string;
    assetType: AssetType;
    name: string;
    extra?: Record<string, unknown>;
  }) {
    const sizeBytes = await this.storage.size(input.storageKey);
    if (!sizeBytes) throw new AppError(500, 'missing_output', `Expected output ${input.name} was not produced`);
    const format = input.storageKey.split('.').pop()!.toLowerCase();
    const metadata =
      format === 'zip' || format === 'json'
        ? {}
        : await this.python.call<Inspection>(
            'geometry',
            'POST',
            '/inspect',
            { key: input.storageKey },
            { timeoutMs: 300_000 },
          );
    return this.prisma.asset.create({
      data: {
        projectId: input.projectId,
        jobId: input.jobId,
        parentAssetId: input.parentAssetId ?? null,
        name: input.name,
        storageKey: input.storageKey,
        assetType: input.assetType,
        format,
        sizeBytes,
        metadata: { ...metadata, ...input.extra },
      },
    });
  }

  async getOwned(userId: string, assetId: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, project: { ownerId: userId } } });
    if (!asset) throw notFound('Asset');
    return asset;
  }

  list(projectId: string) {
    return this.prisma.asset.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }
}

@Global()
@Module({ providers: [AssetsService], exports: [AssetsService] })
export class AssetsCoreModule {}
