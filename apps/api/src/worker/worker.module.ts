import { Module } from '@nestjs/common';
import { AssetsCoreModule } from '../assets/assets.service';
import { PythonClientModule } from '../internal/python-client';
import { JobsCoreModule } from '../jobs/jobs.module';
import { loggerModule } from '../logger';
import { PrismaModule } from '../prisma.service';
import { RedisModule } from '../redis.service';
import { StorageModule } from '../storage/storage.service';
import { GeometryRunner } from './geometry.runner';
import { ReconstructionRunner } from './reconstruction.runner';
import { WorkerLifecycle } from './lifecycle';
import { WorkerService } from './worker.service';

@Module({
  imports: [
    loggerModule,
    PrismaModule,
    RedisModule,
    PythonClientModule,
    StorageModule,
    JobsCoreModule,
    AssetsCoreModule,
  ],
  providers: [WorkerService, WorkerLifecycle, ReconstructionRunner, GeometryRunner],
})
export class WorkerModule {}
