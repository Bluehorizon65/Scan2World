import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppError } from './app-error';

const CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'validation_failed',
  429: 'rate_limited',
  503: 'service_unavailable',
};

/** Renders every error as { error: { code, message, requestId, details? } }; never leaks stack traces. */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const requestId = String(req.id ?? req.headers['x-request-id'] ?? '');

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      ({ code, details } = exception);
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODES[status] ?? 'error';
      const body = exception.getResponse();
      if (typeof body === 'object' && body && 'message' in body) {
        const m = body.message;
        // class-validator returns an array of messages
        if (Array.isArray(m)) {
          message = 'Validation failed';
          details = m;
          code = 'validation_failed';
        } else message = String(m);
      } else message = exception.message;
    } else {
      this.logger.error(exception);
    }
    if (res.headersSent) return;
    res.status(status).json({ error: { code, message, requestId, ...(details ? { details } : {}) } });
  }
}
