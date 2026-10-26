export type ImageType = 'jpeg' | 'png' | 'webp';

export const IMAGE_MIME: Record<ImageType, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Identify an image by its signature bytes, ignoring the client-supplied name and content type. */
export function detectImageType(head: Buffer): ImageType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP')
    return 'webp';
  return null;
}
