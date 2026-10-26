#!/usr/bin/env node
// End-to-end API smoke test against a running stack: register -> project -> upload photos -> validate ->
// reconstruct -> wait -> list assets -> download the mesh. Uses only Node 22 built-ins.
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

let job = await call('POST', `/projects/${project.id}/jobs/reconstruction`, { quality: process.env.QUALITY ?? 'draft' });
let last = '';
while (!['completed', 'failed', 'cancelled'].includes(job.status)) {
  await new Promise((r) => setTimeout(r, 2000));
  job = await call('GET', `/jobs/${job.id}`);
  const p = job.progress ? ` ${job.progress.label} ${job.progress.current}/${job.progress.total}` : '';
  const line = `${job.status} ${job.stage ?? ''}${p}`;
  if (line !== last) log(line);
  last = line;
}
if (job.status !== 'completed') {
  console.error('job ended', job.status, job.errorCode, job.errorMessage, job.diagnostics?.advice ?? '');
  process.exit(1);
}
const { items } = await call('GET', `/projects/${project.id}/assets`);
for (const a of items) log('asset', a.assetType, a.format, `${(a.sizeBytes / 1e6).toFixed(2)} MB`, a.metadata.triangles ?? a.metadata.points);
const mesh = items.find((a) => a.assetType === 'mesh_visual');
const glb = await call('GET', `/assets/${mesh.id}/download`);
if (glb.subarray(0, 4).toString() !== 'glTF') throw new Error('downloaded mesh is not a GLB');
log(`downloaded GLB ${glb.length} bytes — OK`);
