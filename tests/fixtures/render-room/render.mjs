// Renders the synthetic room into N deterministic JPEG "photos" for reconstruction tests.
//   node fixtures/render-room/render.mjs [count=36] [outDir=fixtures/render-room/out]
import { chromium } from '@playwright/test';
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const count = Number(process.argv[2] ?? 36);
const out = resolve(process.argv[3] ?? join(here, 'out'));
const threeDir = resolve(here, '../../node_modules/three');

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = url.pathname === '/' ? join(here, 'room.html') : url.pathname.startsWith('/three/') ? join(threeDir, url.pathname.slice(7)) : null;
  if (!file || !resolve(file).startsWith(here) && !resolve(file).startsWith(threeDir)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': extname(file) === '.js' ? 'text/javascript' : 'text/html' });
  createReadStream(file).on('error', () => res.end()).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?w=1600&h=1200`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60_000 });
  mkdirSync(out, { recursive: true });
  for (let i = 0; i < count; i++) {
    const dataUrl = await page.evaluate(([i, n]) => window.renderView(i, n), [i, count]);
    writeFileSync(join(out, `room_${String(i).padStart(3, '0')}.jpg`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  console.log(`rendered ${count} views to ${out}`);
} finally {
  await browser.close();
  server.close();
}
