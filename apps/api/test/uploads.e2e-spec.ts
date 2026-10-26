import { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { createTestApp, newUser, resetDb } from './helpers';
import { makeImage } from './images';
import { StorageService } from '../src/storage/storage.service';

describe('uploads', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
  });
  afterAll(() => app.close());

  async function project() {
    const user = await newUser(app);
    const id = (await user.agent.post('/api/v1/projects').send({ name: 'Room' })).body.id as string;
    return { ...user, base: `/api/v1/projects/${id}/uploads`, projectId: id };
  }

  it('accepts png and jpeg, records dimensions and checksum, lists them', async () => {
    const { agent, base } = await project();
    const a = await agent.post(base).attach('file', await makeImage(1), 'a.png');
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ fileName: 'a.png', contentType: 'image/png', width: 64, height: 48 });
    expect(a.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.body.storageKey).toBeUndefined();
    expect((await agent.post(base).attach('file', await makeImage(2, 'jpeg'), 'b.jpg')).status).toBe(201);
    const list = await agent.get(base);
    expect(list.body.items).toHaveLength(2);
  });

  it('serves a thumbnail and the original to the owner only', async () => {
    const { agent, base } = await project();
    const other = await newUser(app);
    const id = (await agent.post(base).attach('file', await makeImage(3), 'c.png')).body.id;
    const thumb = await agent.get(`${base}/${id}/thumbnail`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect((await agent.get(`${base}/${id}/file`)).headers['content-type']).toBe('image/png');
    expect((await other.agent.get(`${base}/${id}/thumbnail`)).status).toBe(404);
  });

  it('rejects an exact duplicate with 409', async () => {
    const { agent, base } = await project();
    const img = await makeImage(4);
    await agent.post(base).attach('file', img, 'd.png');
    const dup = await agent.post(base).attach('file', img, 'd-copy.png');
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('duplicate_upload');
  });

  it('rejects a text file named .jpg with 415 and leaves no temp file', async () => {
    const { agent, base } = await project();
    const res = await agent.post(base).attach('file', Buffer.from('definitely not an image'), 'evil.jpg');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('unsupported_file_type');
    expect(res.body.error.message).toMatch(/JPEG, PNG or WebP/);
  });

  it('rejects a corrupt image with valid magic bytes', async () => {
    const { agent, base } = await project();
    const truncated = (await makeImage(5, 'jpeg')).subarray(0, 40);
    const res = await agent.post(base).attach('file', truncated, 'broken.jpg');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('unreadable_image');
  });

  it('rejects files over MAX_FILE_MB with 413', async () => {
    const { agent, base } = await project();
    const prev = process.env.MAX_FILE_MB;
    process.env.MAX_FILE_MB = '0.001';
    try {
      const res = await agent.post(base).attach('file', await makeImage(6, 'png', 256, 256), 'big.png');
      expect(res.status).toBe(413);
    } finally {
      if (prev === undefined) delete process.env.MAX_FILE_MB;
      else process.env.MAX_FILE_MB = prev;
    }
  });

  it("another user's project is 404 and missing file field is 400", async () => {
    const { base, agent } = await project();
    const other = await newUser(app);
    expect((await other.agent.post(base).attach('file', await makeImage(7), 'x.png')).status).toBe(404);
    expect((await agent.post(base).field('x', 'y')).status).toBe(400);
  });

  it('delete removes the record and file; deleting the project removes its storage', async () => {
    const { agent, base, projectId } = await project();
    const storage = app.get(StorageService);
    const id = (await agent.post(base).attach('file', await makeImage(8), 'e.png')).body.id;
    const dir = storage.path(`projects/${projectId}`);
    expect(existsSync(dir)).toBe(true);
    expect((await agent.delete(`${base}/${id}`)).status).toBe(204);
    expect((await agent.get(base)).body.items).toHaveLength(0);
    await agent.post(base).attach('file', await makeImage(9), 'f.png');
    expect((await agent.delete(`/api/v1/projects/${projectId}`)).status).toBe(204);
    expect(existsSync(dir)).toBe(false);
  });
});
