#!/usr/bin/env node
// End-to-end API smoke test against a running stack: register -> project -> upload photos -> validate ->
// reconstruct -> clean + align -> game-map prep -> export package -> download. Uses only Node 22 built-ins.
//   node infrastructure/scripts/smoke-test.mjs [photosDir=tests/fixtures/render-room/out] [apiBase=http://localhost:3000]
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'tests/fixtures/render-room/out');
const api = `${process.argv[3] ?? 'http://localhost:3000'}/api/v1`;
let cookie = '';

async function call(method, path, body, isForm = false) {
  const res = await fetch(api + path, {
    method,
    headers: { cookie, ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

await call('POST', '/auth/register', { email: `smoke-${Date.now()}@example.com`, password: 'smoke-test-password' });
const project = await call('POST', '/projects', { name: `Smoke ${new Date().toISOString()}` });
log('project', project.id);

const files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
for (const f of files) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(join(dir, f))]), f);
  await call('POST', `/projects/${project.id}/uploads`, form, true);
}
log(`uploaded ${files.length} photos`);

const validation = await call('POST', `/projects/${project.id}/validate`);
log('validation rating:', validation.dataset.rating, '| usable', validation.dataset.usable);

async function waitJob(job) {
  let last = '';
  while (!['completed', 'failed', 'cancelled'].includes(job.status)) {
    await new Promise((r) => setTimeout(r, 2000));
    job = await call('GET', `/jobs/${job.id}`);
    const p = job.progress ? ` ${job.progress.label} ${job.progress.current}/${job.progress.total}` : '';
    const line = `${job.kind}: ${job.status} ${job.stage ?? ''}${p}`;
    if (line !== last) log(line);
    last = line;
  }
  if (job.status !== 'completed') {
    console.error('job ended', job.status, job.errorCode, job.errorMessage, job.diagnostics?.advice ?? '');
    process.exit(1);
  }
  return job;
}
const assetsOf = async (job) => (await call('GET', `/projects/${project.id}/assets`)).items.filter((a) => a.jobId === job.id);
const show = (a) => log('  asset', a.assetType.padEnd(18), a.format, `${(a.sizeBytes / 1e6).toFixed(2)} MB`, a.metadata.triangles ?? a.metadata.points ?? '');

const recon = await waitJob(await call('POST', `/projects/${project.id}/jobs/reconstruction`, { quality: process.env.QUALITY ?? 'draft' }));
const reconAssets = await assetsOf(recon);
reconAssets.forEach(show);
const mesh = reconAssets.find((a) => a.assetType === 'mesh_visual');
const glb = await call('GET', `/assets/${mesh.id}/download`);
if (glb.subarray(0, 4).toString() !== 'glTF') throw new Error('downloaded mesh is not a GLB');

const proc = await waitJob(await call('POST', `/assets/${mesh.id}/process`, { ops: [{ op: 'remove_small_components', minFaceRatio: 0.01 }, { op: 'align_floor' }] }));
const processed = (await assetsOf(proc))[0];
show(processed);
const align = processed.metadata.ops.find((s) => s.op === 'align_floor');
log(`  floor alignment: method=${align.method} confidence=${align.confidence} inliers=${align.floorInlierRatio}`);

const gm = await waitJob(await call('POST', `/assets/${processed.id}/gamemap`, { collisionTargetTriangles: 4000, maxSlopeDeg: 30 }));
const gmAssets = await assetsOf(gm);
gmAssets.forEach(show);
const report = gm.resultManifest.report;
log(`  walkable: ${report.walkable.confidence} confidence, coverage ${report.walkable.coverage}; collision valid=${report.collision.valid}`);
(report.warnings ?? []).forEach((w) => log('  warning:', w));

const visual = gmAssets.find((a) => a.assetType === 'mesh_visual');
const exp = await waitJob(await call('POST', `/assets/${visual.id}/export`, { formats: ['glb', 'obj', 'ply'] }));
const pkg = (await assetsOf(exp))[0];
const pkgFiles = pkg.metadata.manifest.files;
log(`  package: ${pkgFiles.length} files, all valid: ${pkgFiles.every((f) => f.validation === 'ok')}`);
const zip = await call('GET', `/assets/${pkg.id}/download`);
if (zip.subarray(0, 2).toString() !== 'PK') throw new Error('downloaded package is not a zip');
log(`downloaded package ${zip.length} bytes — OK`);
