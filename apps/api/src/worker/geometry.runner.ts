import { Injectable } from '@nestjs/common';
import { JobKind } from '@prisma/client';
import { JobsService } from '../jobs/jobs.service';

/** Processing / game-map / export jobs (geometry service). Implemented in the geometry milestone. */
@Injectable()
export class GeometryRunner {
  constructor(private jobs: JobsService) {}

  async run(jobId: string, kind: JobKind) {
    await this.jobs.transition(jobId, 'failed', {
      errorCode: 'not_implemented',
      errorMessage: `${kind} jobs are not available yet`,
    });
  }
}
