import { expect, test, type Page } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_DIR } from './global-setup';

const photos = () => readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.jpg')).sort().map((f) => join(FIXTURE_DIR, f));

async function register(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Email').fill(`e2e-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('photos to downloadable game-map package', async ({ page }) => {
  await register(page);
  await createProject(page, 'E2E room');
  const projectUrl = page.url();

  // Invalid upload: a text file renamed .jpg is rejected client-side by type, and a spoofed JPEG by the server.
  await page.getByLabel('Photo files').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText('notes.txt is not a JPEG, PNG or WebP image.')).toBeVisible();
  await page.getByLabel('Photo files').setInputFiles({ name: 'fake.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not really a jpeg') });
  await expect(page.getByText('Only JPEG, PNG or WebP images are supported')).toBeVisible();

  await page.getByLabel('Photo files').setInputFiles(photos());
  await expect(page.getByText('36 uploaded')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Check photos' }).click();
  await expect(page.getByText('Good capture')).toBeVisible({ timeout: 60_000 });

  await page.getByText('Fastest. Smaller images').click();
  await page.getByRole('button', { name: 'Start reconstruction' }).click();
  await expect(page.getByText('Matching features')).toBeVisible();
  await expect(page.getByText('Latest run')).toBeVisible({ timeout: 8 * 60_000 });
  await expect(page.getByText('completed', { exact: true })).toBeVisible();
  await expect(page.getByText(/36 of 36 photos placed/)).toBeVisible();

  // 3D studio: real stats and view modes.
  await page.getByRole('link', { name: 'Open the 3D studio' }).click();
  await expect(page.getByRole('complementary', { name: 'Inspector' }).getByText('Triangles')).toBeVisible();
  await expect(page.getByText(/[\d,]+ triangles/).first()).toBeVisible();
  await page.getByRole('radio', { name: 'Wireframe' }).click();
  await page.getByRole('radio', { name: 'Orthographic' }).click();
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0); // no model load errors

  // Game-map preparation: clean + level, then generate collision/walkable.
  await page.goto(`${projectUrl}/prepare`);
  await page.getByRole('button', { name: 'Process mesh' }).click();
  await expect(page.getByRole('combobox', { name: 'Source mesh' })).toContainText('levelled', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Generate game-map assets' }).click();
  await expect(page.getByText('Game-map report')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('No navigation mesh')).toBeVisible();

  // Export and download.
  await page.getByRole('link', { name: 'Export these assets' }).click();
  await page.getByRole('button', { name: 'Create package' }).click();
  await expect(page.getByText('Every file was re-read after export and matches the source geometry.')).toBeVisible({ timeout: 120_000 });
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download package' }).first().click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.zip$/);
});

test('reconstruction of unrelated images fails with actionable advice', async ({ page }) => {
  await register(page);
  await createProject(page, 'E2E failure');
  // Random-noise images share no features, so COLMAP cannot register a model.
  const files = await page.evaluate(async () => {
    const out: { name: string; data: number[] }[] = [];
    for (let i = 0; i < 6; i++) {
      const c = document.createElement('canvas');
      c.width = 640; c.height = 480;
      const g = c.getContext('2d')!;
      const img = g.createImageData(640, 480);
      for (let p = 0; p < img.data.length; p++) img.data[p] = (p % 4 === 3) ? 255 : Math.floor(Math.random() * 256);
      g.putImageData(img, 0, 0);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
      out.push({ name: `noise_${i}.png`, data: Array.from(new Uint8Array(await blob.arrayBuffer())) });
    }
    return out;
  });
  await page.getByLabel('Photo files').setInputFiles(files.map((f) => ({ name: f.name, mimeType: 'image/png', buffer: Buffer.from(f.data) })));
  await expect(page.getByText('6 uploaded')).toBeVisible({ timeout: 60_000 });
  await page.getByText('Fastest. Smaller images').click();
  await page.getByRole('button', { name: 'Start reconstruction' }).click();
  await expect(page.getByText('Camera poses could not be recovered', { exact: false })).toBeVisible({ timeout: 3 * 60_000 });
  await expect(page.getByText('Capture in one continuous loop', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});
