import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma.service';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  return app;
}

export async function resetDb(app: INestApplication) {
  const prisma = app.get(PrismaService);
  await prisma.$executeRawUnsafe('TRUNCATE "User", "Project", "Upload", "Job", "JobEvent", "Asset" CASCADE');
}

let counter = 0;
/** Registers a fresh user and returns an agent carrying its session cookie. */
export async function newUser(app: INestApplication) {
  const email = `user${Date.now()}${counter++}@example.com`;
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/v1/auth/register').send({ email, password: 'correct-horse-battery' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, email, id: res.body.user.id as string };
}
