import { INestApplication } from '@nestjs/common';
import { createTestApp, newUser, resetDb } from './helpers';

describe('projects', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
  });
  afterAll(() => app.close());

  it('CRUD for the owner', async () => {
    const { agent } = await newUser(app);
    const created = await agent.post('/api/v1/projects').send({ name: 'Living room', description: 'north wall' });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await agent.get(`/api/v1/projects/${id}`)).body).toMatchObject({ name: 'Living room', status: 'draft' });
    const patched = await agent.patch(`/api/v1/projects/${id}`).send({ name: 'Lounge' });
    expect(patched.body.name).toBe('Lounge');
    expect((await agent.delete(`/api/v1/projects/${id}`)).status).toBe(204);
    expect((await agent.get(`/api/v1/projects/${id}`)).status).toBe(404);
  });

  it("another user's project is 404 for get/patch/delete and absent from list", async () => {
    const a = await newUser(app);
    const b = await newUser(app);
    const id = (await a.agent.post('/api/v1/projects').send({ name: 'Secret' })).body.id;
    expect((await b.agent.get(`/api/v1/projects/${id}`)).status).toBe(404);
    expect((await b.agent.patch(`/api/v1/projects/${id}`).send({ name: 'x' })).status).toBe(404);
    expect((await b.agent.delete(`/api/v1/projects/${id}`)).status).toBe(404);
    expect((await b.agent.get('/api/v1/projects')).body.items).toEqual([]);
    expect((await a.agent.get(`/api/v1/projects/${id}`)).body.name).toBe('Secret');
  });

  it('list supports search and pagination', async () => {
    const { agent } = await newUser(app);
    for (const name of ['Kitchen', 'Garage', 'Kitchen annex']) await agent.post('/api/v1/projects').send({ name });
    const search = await agent.get('/api/v1/projects?q=kitch');
    expect(search.body.items.map((p: { name: string }) => p.name).sort()).toEqual(['Kitchen', 'Kitchen annex']);
    const page = await agent.get('/api/v1/projects?page=2&pageSize=2');
    expect(page.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.body.items).toHaveLength(1);
  });

  it('rejects empty names and non-uuid ids', async () => {
    const { agent } = await newUser(app);
    expect((await agent.post('/api/v1/projects').send({ name: '' })).status).toBe(400);
    expect((await agent.get('/api/v1/projects/not-a-uuid')).status).toBe(404);
  });
});
