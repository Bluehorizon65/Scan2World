import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { env } from './env';

export const loggerModule = LoggerModule.forRoot({
  pinoHttp: {
    level: env.logLevel,
    genReqId: (req, res) => {
      const header = req.headers['x-request-id'];
      const id = typeof header === 'string' && /^[\w-]{1,64}$/.test(header) ? header : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    redact: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-service-token"]',
      'res.headers["set-cookie"]',
    ],
    autoLogging: { ignore: (req) => req.url?.endsWith('/health') ?? false },
  },
});
