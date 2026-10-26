import { INestApplication } from '@nestjs/common';
import { createTestApp, newUser, resetDb } from './helpers';
import { makeImage } from './images';
import { PythonStub } from './python-stub';

describe('dataset validation', () => {
  let app: INestApplication;
  const stub = new PythonStub();
  beforeAll(async () => {
    process.env.VISION_URL = await stub.start();
    app = await createTestApp();
    await resetDb(app);
  });
  afterAll(async () => {
    await app.close();
    await stub.stop();
  });

  it('sends storage keys to vision, stores per-image results, returns them by upload id without keys', async () => {
    const { agent } = await newUser(app);
    const pid = (await agent.post('/api/v1/projects').send({ name: 'Room' })).body.id;
    const ids: string[] = [];
    for (const seed of [1, 2])
      ids.push(
        (await agent.post(`/api/v1/projects/${pid}/uploads`).attach('file', await makeImage(seed), `${seed}.png`)).body
          .id,
      );

    stub.on('POST /analyze', (body: { keys: string[] }) => ({
      body: {
        images: body.keys.map((key, i) => ({
          key,
          readable: true,
          width: 64,
          height: 48,
          blur: i ? 10 : 300,
          brightness: 120,
          contrast: 50,
          keypoints: 900,
          dhash: 'ab',
          issues: i ? ['blurry'] : [],
        })),
        dataset: {
          count: 2,
          usable: 1,
          duplicateGroups: [body.keys],
          rating: 'poor',
          recommendations: ['Capture at least 20'],
          notes: ['overlap not measured'],
        },
      },
    }));

    const res = await agent.post(`/api/v1/projects/${pid}/validate`);
    expect(res.status).toBe(200);
    const call = stub.calls.find((c) => c.route === 'POST /analyze')!;
    expect(call.token).toBe(process.env.SERVICE_TOKEN);
    expect(call.body.keys).toHaveLength(2);
    expect(call.body.keys[0]).toMatch(new RegExp(`^projects/${pid}/uploads/`));

    expect(res.body.dataset).toMatchObject({ rating: 'poor', usable: 1, duplicateGroups: [ids] });
    expect(res.body.images.map((i: { uploadId: string }) => i.uploadId)).toEqual(ids);
    expect(JSON.stringify(res.body)).not.toContain('projects/');

    const uploads = (await agent.get(`/api/v1/projects/${pid}/uploads`)).body.items;
    expect(uploads[1].metadata.quality.issues).toEqual(['blurry']);
    expect((await agent.get(`/api/v1/projects/${pid}`)).body.validation.rating).toBe('poor');
  });

  it('empty project is 409 no_uploads; vision down is 503 with a clear message', async () => {
    const { agent } = await newUser(app);
    const pid = (await agent.post('/api/v1/projects').send({ name: 'Empty' })).body.id;
    expect((await agent.post(`/api/v1/projects/${pid}/validate`)).body.error.code).toBe('no_uploads');

    await agent.post(`/api/v1/projects/${pid}/uploads`).attach('file', await makeImage(3), 'x.png');
    const prev = process.env.VISION_URL;
    process.env.VISION_URL = 'http://127.0.0.1:1';
    try {
      const res = await agent.post(`/api/v1/projects/${pid}/validate`);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({
        code: 'service_unavailable',
        message: 'The vision service is unavailable',
      });
    } finally {
      process.env.VISION_URL = prev;
    }
  });
});
