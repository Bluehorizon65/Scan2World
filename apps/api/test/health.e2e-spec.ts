import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers';

describe('health', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(() => app.close());

  it('GET /api/v1/health is ok and echoes a request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').set('x-request-id', 'abc-123');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('GET /api/v1/ready reports db and redis up and python services individually', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.database).toBe('up');
    expect(res.body.checks.redis).toBe('up');
    expect(Object.keys(res.body.checks.services).sort()).toEqual(['geometry', 'recon', 'vision']);
  });

  it('GET /api/v1/config exposes upload limits to the UI', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      maxImages: expect.any(Number),
      maxFileBytes: expect.any(Number),
      minImages: expect.any(Number),
    });
  });

  it('unknown route returns the structured error shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'not_found', requestId: expect.any(String) });
  });
});
