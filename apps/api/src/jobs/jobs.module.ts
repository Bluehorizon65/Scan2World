import { Global, Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

/** Service only; shared by the API and the worker. */
@Global()
@Module({ providers: [JobsService], exports: [JobsService] })
export class JobsCoreModule {}

@Module({ imports: [JobsCoreModule], controllers: [JobsController] })
export class JobsModule {}
