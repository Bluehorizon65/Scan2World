import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/auth.guard';
import { env, SERVICE_NAMES } from '../env';
import { PythonClient } from '../internal/python-client';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';

const up = (ok: boolean) => (ok ? 'up' : 'down');

@ApiTags('system')
@Public()
@Controller()
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private python: PythonClient,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  /** Limits the UI enforces client-side before uploading (the API enforces them again). */
  @Get('config')
  config() {
    return { maxImages: env.maxImages, maxFileBytes: env.maxFileBytes, minImages: env.minImages };
  }

  /** 503 only when the API itself cannot work (db/redis); python services are reported individually. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, redis, ...svc] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      this.redis.client.ping().then(
        () => true,
        () => false,
      ),
      ...SERVICE_NAMES.map((s) => this.python.health(s)),
    ]);
    const services = Object.fromEntries(SERVICE_NAMES.map((s, i) => [s, up(svc[i])]));
    const ok = database && redis;
    if (!ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ready' : 'unavailable', checks: { database: up(database), redis: up(redis), services } };
  }
}
