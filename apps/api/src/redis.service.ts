import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { env } from './env';

/** Shared Redis connection (commands + publish). Subscribers create their own via duplicate(). */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis(env.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });

  onModuleDestroy() {
    this.client.disconnect();
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
