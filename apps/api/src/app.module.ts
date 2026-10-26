import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PythonClientModule } from './internal/python-client';
import { loggerModule } from './logger';
import { PrismaModule } from './prisma.service';
import { RedisModule } from './redis.service';

@Module({
  imports: [loggerModule, PrismaModule, RedisModule, PythonClientModule],
  controllers: [HealthController],
})
export class AppModule {}
