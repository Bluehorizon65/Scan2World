import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { StorageService } from '../src/storage/storage.service';
import { WorkerModule } from '../src/worker/worker.module';
import { createTestApp, newUser, resetDb } from './helpers';
import { makeImage } from './images';
import { PythonStub } from './python-stub';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('reconstruction jobs (stubbed python services)', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  const recon = new PythonStub();
  const geometry = new PythonStub();
  let storage: StorageService;

  const writeKey = (key: string, bytes = 2048) => {
    const p = storage.path(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, Buffer.alloc(bytes, 1));
  };

  beforeAll(async () => {
    process.env.RECON_URL = await recon.start();
    process.env.GEOMETRY_URL = await geometry.start();
    app = await createTestApp();
    await resetDb(app);
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    storage = app.get(StorageService);

    geometry.on('POST /mesh', (b: { outputPrefix: string }) => {
      writeKey(`${b.outputPrefix}/mesh.glb`, 4096);
      return { body: { outputs: { mesh_glb: `${b.outputPrefix}/mesh.glb` }, stats: { method: 'poisson' } } };
    });
    geometry.on('POST /inspect', (b: { key: string }) => ({
      body: b.key.endsWith('.glb')
        ? {
            kind: 'mesh',
            vertices: 500,
            triangles: 1000,
            bbox: { min: [0, 0, 0], max: [1, 2, 3] },
            dimensions: [1, 2, 3],
          }
        : { kind: 'point_cloud', points: 1234, bbox: { min: [0, 0, 0], max: [1, 1, 1] }, dimensions: [1, 1, 1] },
    }));
  });
  afterAll(async () => {
    await worker.close();
    await app.close();
    await recon.stop();
    await geometry.stop();
  });

  async function projectWithImages(n = 3) {
    const user = await newUser(app);
    const pid = (await user.agent.post('/api/v1/projects').send({ name: 'Room' })).body.id as string;
    for (let i = 0; i < n; i++)
      await user.agent.post(`/api/v1/projects/${pid}/uploads`).attach('file', await makeImage(100 + i), `${i}.png`);
    return { ...user, pid };
  }

  async function waitFor(agent: any, jobId: string, statuses: string[], ms = 8000) {
    const end = Date.now() + ms;
    for (;;) {
      const job = (await agent.get(`/api/v1/jobs/${jobId}`)).body;
      if (statuses.includes(job.status)) return job;
      if (Date.now() > end) throw new Error(`job stuck in ${job.status}/${job.stage}`);
      await sleep(30);
    }
  }

  /** recon stub: walks through stages on successive polls per job id, then finishes as scripted. */
  function scriptRecon(final: 'completed' | 'failed' | 'never') {
    const polls = new Map<string, number>();
    const prefixes = new Map<string, string>();
    const stages = ['feature_extraction', 'feature_matching', 'sparse_reconstruction'];
    recon.fallback = (route, b: { outputPrefix: string }) => {
      const m = /^(POST|GET|DELETE) \/jobs\/([\w-]+)$/.exec(route);
      if (!m) return undefined;
      const [, method, id] = m;
      if (method === 'POST') {
        prefixes.set(id, b.outputPrefix);
        return { status: 202, body: { id, status: 'running', stage: 'feature_extraction' } };
      }
      if (method === 'DELETE') return { body: { id, status: 'cancelled' } };
      const n = (polls.get(id) ?? 0) + 1;
      polls.set(id, n);
      if (n <= stages.length || final === 'never')
        return {
          body: { id, status: 'running', stage: stages[Math.min(n, stages.length) - 1], gpu: false, dense: false },
        };
      if (final === 'failed')
        return {
          body: {
            id,
            status: 'failed',
            stage: 'sparse_reconstruction',
            error: { code: 'sparse_reconstruction_failed', message: 'No model', advice: ['Add overlap'] },
          },
        };
      writeKey(`${prefixes.get(id)}/sparse.ply`);
      return {
        body: {
          id,
          status: 'completed',
          stage: 'sparse_reconstruction',
          gpu: false,
          dense: false,
          outputs: { sparse_ply: `${prefixes.get(id)}/sparse.ply` },
          stats: { registered_images: 3, total_images: 3 },
        },
      };
    };
  }

  it('runs to completed through real stages, registering validated assets', async () => {
    const { agent, pid } = await projectWithImages();
    scriptRecon('completed');
    const created = await agent.post(`/api/v1/projects/${pid}/jobs/reconstruction`).send({ quality: 'draft' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: 'reconstruction', status: 'queued' });

    const job = await waitFor(agent, created.body.id, ['completed', 'failed']);
    expect({ status: job.status, error: job.errorMessage }).toEqual({ status: 'completed', error: null });
    const stages = job.events.map((e: { stage: string }) => e.stage);
    expect(stages).toEqual(
      expect.arrayContaining([
        'validation',
        'feature_extraction',
        'feature_matching',
        'sparse_reconstruction',
        'meshing',
        'export_validation',
      ]),
    );
    expect(stages.indexOf('feature_matching')).toBeGreaterThan(stages.indexOf('feature_extraction'));

    const start = recon.calls.find((c) => c.route === `POST /jobs/${job.id}`)!;
    expect(start.body.imageKeys).toHaveLength(3);
    expect(start.body.outputPrefix).toBe(`projects/${pid}/jobs/${job.id}`);

    const assets = (await agent.get(`/api/v1/projects/${pid}/assets`)).body.items;
    const types = assets.map((a: { assetType: string }) => a.assetType).sort();
    expect(types).toEqual(['mesh_visual', 'point_cloud_sparse']);
    const mesh = assets.find((a: { assetType: string }) => a.assetType === 'mesh_visual');
    expect(mesh).toMatchObject({ format: 'glb', sizeBytes: 4096, jobId: job.id });
    expect(mesh.metadata.triangles).toBe(1000);
    expect(mesh.storageKey).toBeUndefined();
  });

  it('streams job events over SSE until terminal', async () => {
    const { agent, pid, cookie } = await projectWithImages();
    scriptRecon('completed');
    const created = (await agent.post(`/api/v1/projects/${pid}/jobs/reconstruction`).send({ quality: 'draft' })).body;
    const server = app.getHttpServer();
    if (!server.address()) await new Promise<void>((r) => server.listen(0, r));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/jobs/${created.id}/events`, {
      headers: { cookie },
    });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const text = await res.text(); // stream closes on terminal state
    const events = text
      .split('\n\n')
      .filter(Boolean)
      .flatMap((chunk) => chunk.split('\n').filter((l) => l.startsWith('data: ')))
      .map((line) => JSON.parse(line.slice(6)));
    expect(events[0].status).toBeDefined();
    expect(events.at(-1).status).toBe('completed');
  });

  it('python failure marks the job failed with code and capture advice', async () => {
    const { agent, pid } = await projectWithImages();
    scriptRecon('failed');
    const created = (await agent.post(`/api/v1/projects/${pid}/jobs/reconstruction`).send({ quality: 'draft' })).body;
    const job = await waitFor(agent, created.id, ['completed', 'failed']);
    expect(job).toMatchObject({
      status: 'failed',
      errorCode: 'sparse_reconstruction_failed',
      errorMessage: 'No model',
    });
    expect(job.diagnostics.advice).toEqual(['Add overlap']);
    expect((await agent.get(`/api/v1/projects/${pid}/assets`)).body.items).toEqual([]);
  });

  it('cancel moves running -> cancelling -> cancelled and tells recon to stop', async () => {
    const { agent, pid } = await projectWithImages();
    scriptRecon('never');
    const created = (await agent.post(`/api/v1/projects/${pid}/jobs/reconstruction`).send({ quality: 'draft' })).body;
    await waitFor(agent, created.id, ['running']);
    const res = await agent.post(`/api/v1/jobs/${created.id}/cancel`);
    expect(res.status).toBe(200);
    const job = await waitFor(agent, created.id, ['cancelled']);
    expect(job.status).toBe('cancelled');
    expect(recon.calls.some((c) => c.route === `DELETE /jobs/${created.id}`)).toBe(true);
    expect((await agent.post(`/api/v1/jobs/${created.id}/cancel`)).status).toBe(409);
  });

  it('retry of a failed job creates a new queued job with the same configuration', async () => {
    const { agent, pid } = await projectWithImages();
    scriptRecon('failed');
    const created = (
      await agent.post(`/api/v1/projects/${pid}/jobs/reconstruction`).send({ quality: 'high', matcher: 'sequential' })
    ).body;
    await waitFor(agent, created.id, ['failed']);
    const retry = await agent.post(`/api/v1/jobs/${created.id}/retry`);
    expect(retry.status).toBe(201);
    expect(retry.body.id).not.toBe(created.id);
    expect(retry.body.configuration).toMatchObject({ quality: 'high', matcher: 'sequential' });
    await waitFor(agent, retry.body.id, ['failed']);
  });

  it('rejects too few images, invalid config, and other users', async () => {
    const { agent, pid } = await projectWithImages(2);
    const few = await agent.post(`/api/v1/projects/${pid}/jobs/reconstruction`).send({ quality: 'draft' });
    expect(few.status).toBe(409);
    expect(few.body.error.code).toBe('not_enough_images');
    expect((await agent.post(`/api/v1/projects/${pid}/jobs/reconstruction`).send({ quality: 'ultra' })).status).toBe(
      400,
    );

    const owner = await projectWithImages();
    scriptRecon('failed');
    const created = (
      await owner.agent.post(`/api/v1/projects/${owner.pid}/jobs/reconstruction`).send({ quality: 'draft' })
    ).body;
    expect((await agent.get(`/api/v1/jobs/${created.id}`)).status).toBe(404);
    expect((await agent.post(`/api/v1/jobs/${created.id}/cancel`)).status).toBe(404);
    await waitFor(owner.agent, created.id, ['failed']);
  });
});
