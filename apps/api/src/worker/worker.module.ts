import { Module } from '@nestjs/common';
import { PythonClientModule } from '../internal/python-client';
import { loggerModule } from '../logger';
import { PrismaModule } from '../prisma.service';
import { RedisModule } from '../redis.service';

@Module({
  imports: [loggerModule, PrismaModule, RedisModule, PythonClientModule],
})
export class WorkerModule {}
