import sharp from 'sharp';

/** Deterministic noisy RGB image (distinct per seed) for upload tests. */
export function makeImage(seed: number, format: 'png' | 'jpeg' = 'png', width = 64, height = 48) {
  const px = Buffer.alloc(width * height * 3);
  let s = seed * 2654435761;
  for (let i = 0; i < px.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    px[i] = s >>> 24;
  }
  return sharp(px, { raw: { width, height, channels: 3 } })
    [format]()
    .toBuffer();
}
