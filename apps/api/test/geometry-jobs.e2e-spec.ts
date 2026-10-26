import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AssetsService } from '../src/assets/assets.service';
import { PrismaService } from '../src/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { WorkerModule } from '../src/worker/worker.module';
import { createTestApp, newUser, resetDb } from './helpers';
import { PythonStub } from './python-stub';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('processing, game-map and export jobs (stubbed geometry service)', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  const geometry = new PythonStub();
  let storage: StorageService;

  const writeKey = (key: string, content: string | Buffer = Buffer.alloc(1024, 1)) => {
    const p = storage.path(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    return key;
  };

  beforeAll(async () => {
    process.env.GEOMETRY_URL = await geometry.start();
    app = await createTestApp();
    await resetDb(app);
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    storage = app.get(StorageService);
    geometry.on('POST /inspect', (b: { key: string }) => ({
      body: { kind: 'mesh', vertices: 10, triangles: b.key.includes('collision') ? 50 : 100, dimensions: [6, 3, 5] },
    }));
    geometry.on('POST /process', (b: { outputPrefix: string; ops: { op: string }[] }) => ({
      body: {
        outputs: { mesh_glb: writeKey(`${b.outputPrefix}/processed.glb`) },
        report: {
          steps: b.ops.map((o) => ({ ...o, trianglesBefore: 100, trianglesAfter: 90 })),
          aligned: b.ops.some((o) => o.op === 'align_floor'),
        },
      },
    }));
    geometry.on('POST /gamemap', (b: { outputPrefix: string }) => ({
      body: {
        outputs: {
          visual_glb: writeKey(`${b.outputPrefix}/visual.glb`),
          collision_glb: writeKey(`${b.outputPrefix}/collision.glb`),
          walkable_glb: writeKey(`${b.outputPrefix}/walkable.glb`),
          report_json: writeKey(`${b.outputPrefix}/gamemap_report.json`, '{"walkable":{"confidence":"medium"}}'),
        },
        report: {
          walkable: { confidence: 'medium', areaUnits2: 28.5 },
          collision: { valid: true },
          navigation: { status: 'not_generated' },
          warnings: ['Scale is not set'],
        },
      },
    }));
    geometry.on('POST /export', (b: { outputPrefix: string; formats: string[] }) => ({
      body: {
        outputs: {
          package_zip: writeKey(`${b.outputPrefix}/package.zip`, Buffer.from('PK\x03\x04zip')),
          manifest_json: writeKey(`${b.outputPrefix}/package/manifest.json`, '{}'),
        },
        manifest: {
          files: b.formats.map((f) => ({ path: `visual.${f}`, validation: 'ok' })),
          coordinateSystem: { upAxis: '+Y' },
        },
      },
    }));
  });
  afterAll(async () => {
    await worker.close();
    await app.close();
    await geometry.stop();
  });

  async function setup() {
    const user = await newUser(app);
    const pid = (await user.agent.post('/api/v1/projects').send({ name: 'Room' })).body.id as string;
    const prisma = app.get(PrismaService);
    const recon = await prisma.job.create({ data: { projectId: pid, kind: 'reconstruction', status: 'completed' } });
    const key = writeKey(`projects/${pid}/jobs/${recon.id}/mesh.glb`);
    writeKey(`projects/${pid}/jobs/${recon.id}/cameras.json`, '{"cameras":[]}');
    const mesh = await app.get(AssetsService).register({
      projectId: pid,
      jobId: recon.id,
      storageKey: key,
      assetType: 'mesh_visual',
      name: 'Reconstructed mesh',
    });
    return { ...user, pid, meshId: mesh.id, reconId: recon.id };
  }

  async function waitDone(agent: any, jobId: string) {
    for (let i = 0; i < 300; i++) {
      const job = (await agent.get(`/api/v1/jobs/${jobId}`)).body;
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
      await sleep(30);
    }
    throw new Error('job did not finish');
  }

  it('process creates a new derived asset with recorded ops; the source is unchanged', async () => {
    const { agent, pid, meshId, reconId } = await setup();
    const ops = [{ op: 'align_floor' }, { op: 'scale', factor: 0.5 }, { op: 'simplify', targetTriangles: 5000 }];
    const created = await agent.post(`/api/v1/assets/${meshId}/process`).send({ ops });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: 'processing', sourceAssetId: meshId });
    const job = await waitDone(agent, created.body.id);
    expect({ status: job.status, error: job.errorMessage }).toEqual({ status: 'completed', error: null });

    const call = geometry.calls.find((c) => c.route === 'POST /process')!;
    expect(call.body.sourceKey).toBe(`projects/${pid}/jobs/${reconId}/mesh.glb`);
    expect(call.body.camerasKey).toBe(`projects/${pid}/jobs/${reconId}/cameras.json`);
    expect(call.body.outputPrefix).toBe(`projects/${pid}/jobs/${job.id}`);

    const assets = (await agent.get(`/api/v1/projects/${pid}/assets`)).body.items;
    const derived = assets.find((a: any) => a.parentAssetId === meshId);
    expect(derived).toMatchObject({ assetType: 'mesh_visual', jobId: job.id });
    expect(derived.metadata).toMatchObject({ aligned: true, scaled: true, reconJobId: reconId });
    expect(derived.metadata.ops.map((s: any) => s.op)).toEqual(['align_floor', 'scale', 'simplify']);
    expect(assets.find((a: any) => a.id === meshId)).toBeDefined();
  });

  it('gamemap registers visual, collision, walkable and report as separate assets', async () => {
    const { agent, pid, meshId } = await setup();
    const created = await agent
      .post(`/api/v1/assets/${meshId}/gamemap`)
      .send({ collisionTargetTriangles: 2000, maxSlopeDeg: 30 });
    expect(created.status).toBe(201);
    const job = await waitDone(agent, created.body.id);
    expect(job.status).toBe('completed');
    const call = geometry.calls.filter((c) => c.route === 'POST /gamemap').at(-1)!;
    expect(call.body).toMatchObject({ collisionTargetTriangles: 2000, maxSlopeDeg: 30, align: true, scaled: false });

    const assets = (await agent.get(`/api/v1/projects/${pid}/assets`)).body.items.filter(
      (a: any) => a.jobId === job.id,
    );
    const byType = Object.fromEntries(assets.map((a: any) => [a.assetType, a]));
    expect(Object.keys(byType).sort()).toEqual(['mesh_collision', 'mesh_visual', 'report', 'walkable']);
    expect(byType.mesh_visual.parentAssetId).toBe(meshId);
    expect(byType.mesh_collision.parentAssetId).toBe(byType.mesh_visual.id);
    expect(byType.walkable.parentAssetId).toBe(byType.mesh_visual.id);
    expect(job.resultManifest.report.walkable.confidence).toBe('medium');
  });

  it('export of a game visual includes its collision and walkable meshes and is downloadable by the owner only', async () => {
    const { agent, pid, meshId } = await setup();
    const gm = await waitDone(agent, (await agent.post(`/api/v1/assets/${meshId}/gamemap`).send({})).body.id);
    const visual = (await agent.get(`/api/v1/projects/${pid}/assets`)).body.items.find(
      (a: any) => a.jobId === gm.id && a.assetType === 'mesh_visual',
    );

    const created = await agent
      .post(`/api/v1/assets/${visual.id}/export`)
      .send({ formats: ['glb', 'obj'], includeCollision: true, includeWalkable: true });
    expect(created.status).toBe(201);
    const job = await waitDone(agent, created.body.id);
    expect(job.status).toBe('completed');
    const call = geometry.calls.filter((c) => c.route === 'POST /export').at(-1)!;
    expect(call.body.sources.map((s: any) => s.role).sort()).toEqual(['collision', 'visual', 'walkable']);
    expect(call.body.metadata).toMatchObject({ projectName: 'Room', units: 'unitless' });

    const pkg = (await agent.get(`/api/v1/projects/${pid}/assets`)).body.items.find(
      (a: any) => a.assetType === 'export_package',
    );
    expect(pkg.metadata.manifest.files).toHaveLength(2);
    const dl = await agent
      .get(`/api/v1/assets/${pkg.id}/download`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/attachment; filename=".+\.zip"/);
    expect(dl.body.subarray(0, 2).toString()).toBe('PK');
    const other = await newUser(app);
    expect((await other.agent.get(`/api/v1/assets/${pkg.id}/download`)).status).toBe(404);
    expect((await other.agent.post(`/api/v1/assets/${visual.id}/export`).send({ formats: ['glb'] })).status).toBe(404);
  });

  it('rejects invalid ops, unsupported formats, and non-mesh sources', async () => {
    const { agent, pid, meshId } = await setup();
    expect((await agent.post(`/api/v1/assets/${meshId}/process`).send({ ops: [] })).status).toBe(400);
    expect((await agent.post(`/api/v1/assets/${meshId}/process`).send({ ops: [{ op: 'explode' }] })).status).toBe(400);
    expect(
      (await agent.post(`/api/v1/assets/${meshId}/process`).send({ ops: [{ op: 'scale', factor: -1 }] })).status,
    ).toBe(400);
    expect((await agent.post(`/api/v1/assets/${meshId}/export`).send({ formats: ['fbx'] })).status).toBe(400);
    const gm = await waitDone(agent, (await agent.post(`/api/v1/assets/${meshId}/gamemap`).send({})).body.id);
    const report = (await agent.get(`/api/v1/projects/${pid}/assets`)).body.items.find(
      (a: any) => a.jobId === gm.id && a.assetType === 'report',
    );
    const res = await agent.post(`/api/v1/assets/${report.id}/process`).send({ ops: [{ op: 'align_floor' }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('not_a_mesh');
  });

  it('a geometry domain error fails the job with its code and message', async () => {
    const { agent, meshId } = await setup();
    geometry.on('POST /process', () => ({
      status: 422,
      body: { error: { code: 'floor_not_found', message: 'No floor-like plane was found.' } },
    }));
    const job = await waitDone(
      agent,
      (await agent.post(`/api/v1/assets/${meshId}/process`).send({ ops: [{ op: 'align_floor' }] })).body.id,
    );
    expect(job).toMatchObject({
      status: 'failed',
      errorCode: 'floor_not_found',
      errorMessage: 'No floor-like plane was found.',
    });
  });
});
