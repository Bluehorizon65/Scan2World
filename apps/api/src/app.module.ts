import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { PythonClientModule } from './internal/python-client';
import { loggerModule } from './logger';
import { ProjectsModule } from './projects/projects.module';
import { PrismaModule } from './prisma.service';
import { RedisModule } from './redis.service';

@Module({
  imports: [loggerModule, PrismaModule, RedisModule, PythonClientModule, AuthModule, ProjectsModule],
  controllers: [HealthController],
})
export class AppModule {}
