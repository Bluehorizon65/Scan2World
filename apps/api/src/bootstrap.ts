import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { HttpErrorFilter } from './common/http-error.filter';
import { env } from './env';

/** Shared HTTP setup for main.ts and e2e tests. */
export function configureApp(app: INestApplication) {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: env.webOrigin, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableShutdownHooks();

  const doc = new DocumentBuilder().setTitle('Scan2World API').setVersion('1.0').addCookieAuth('s2w_session').build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc), {
    jsonDocumentUrl: 'api/docs-json',
  });
}
