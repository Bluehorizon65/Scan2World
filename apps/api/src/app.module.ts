import { Module } from '@nestjs/common';
import { AssetsModule } from './assets/assets.controller';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { PythonClientModule } from './internal/python-client';
import { JobsModule } from './jobs/jobs.module';
import { loggerModule } from './logger';
import { PrismaModule } from './prisma.service';
import { ProjectsModule } from './projects/projects.module';
import { RedisModule } from './redis.service';
import { StorageModule } from './storage/storage.service';
import { UploadsModule } from './uploads/uploads.module';

@Module({
  imports: [
    loggerModule,
    PrismaModule,
    RedisModule,
    PythonClientModule,
    StorageModule,
    AuthModule,
    ProjectsModule,
    UploadsModule,
    JobsModule,
    AssetsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
