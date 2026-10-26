import { HttpException } from '@nestjs/common';

/** HTTP error with a stable machine-readable code; rendered by HttpErrorFilter. */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
