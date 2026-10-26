import { Injectable } from '@nestjs/common';

/** Set when the worker process is shutting down; runners stop at the next safe point instead of failing jobs. */
@Injectable()
export class WorkerLifecycle {
  stopping = false;
}

/** Thrown by runners to hand the job back to the queue for the next worker to resume. */
export class ShutdownError extends Error {
  constructor() {
    super('worker shutting down');
  }
}
