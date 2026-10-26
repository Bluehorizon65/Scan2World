import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { env, ServiceName } from '../env';

/** Error returned by a Python service: { error: { code, message, advice? } }. */
export class ServiceCallError extends AppError {
  constructor(
    status: number,
    code: string,
    message: string,
    readonly advice: string[] = [],
  ) {
    super(status >= 500 ? 502 : status, code, message, advice.length ? { advice } : undefined);
  }
}

interface CallOptions {
  timeoutMs?: number;
  /** Retries on connection failure only (never on an HTTP error response). */
  retries?: number;
  requestId?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class PythonClient {
  private readonly logger = new Logger(PythonClient.name);

  async call<T>(
    service: ServiceName,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    opts: CallOptions = {},
  ): Promise<T> {
    const { timeoutMs = 30_000, retries = 3, requestId } = opts;
    const url = env.services[service] + path;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: {
            'content-type': 'application/json',
            'x-service-token': env.serviceToken,
            ...(requestId ? { 'x-request-id': requestId } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (attempt < retries && !(err instanceof DOMException && err.name === 'TimeoutError')) {
          this.logger.warn(`${service} ${method} ${path} connection failed (attempt ${attempt + 1}), retrying`);
          await sleep(500 * 2 ** attempt);
          continue;
        }
        const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
        throw new AppError(
          503,
          timedOut ? 'service_timeout' : 'service_unavailable',
          timedOut ? `The ${service} service did not respond in time` : `The ${service} service is unavailable`,
        );
      }
      const json = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string; advice?: string[] };
      };
      if (!res.ok) {
        const e = json.error ?? {};
        throw new ServiceCallError(
          res.status,
          e.code ?? 'service_error',
          e.message ?? `${service} request failed`,
          e.advice,
        );
      }
      return json as T;
    }
  }

  async health(service: ServiceName): Promise<boolean> {
    try {
      await this.call(service, 'GET', '/health', undefined, { timeoutMs: 2_000, retries: 0 });
      return true;
    } catch {
      return false;
    }
  }
}

@Global()
@Module({ providers: [PythonClient], exports: [PythonClient] })
export class PythonClientModule {}
