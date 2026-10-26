import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDb } from './helpers';

describe('auth', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
  });
  afterAll(() => app.close());

  const creds = { email: 'Ada@Example.com', password: 'correct-horse-battery' };

  it('register sets an httpOnly session cookie and normalizes email', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send(creds);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'ada@example.com' });
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/s2w_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('duplicate email is 409', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send(creds);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('email_taken');
  });

  it('weak password and bad email are 400 validation errors', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'nope', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('login then me returns the user; logout clears the session', async () => {
    const agent = request.agent(app.getHttpServer());
    expect((await agent.post('/api/v1/auth/login').send(creds)).status).toBe(200);
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('ada@example.com');
    await agent.post('/api/v1/auth/logout');
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('wrong password is 401 invalid_credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ ...creds, password: 'wrong-password-123' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });

  it('protected routes reject missing and forged cookies', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/projects')).status).toBe(401);
    const forged = await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Cookie', 's2w_session=eyJhbGciOiJIUzI1NiJ9.e30.x');
    expect(forged.status).toBe(401);
  });
});
