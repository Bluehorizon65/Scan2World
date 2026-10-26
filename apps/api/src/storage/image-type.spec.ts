import { detectImageType } from './image-type';

describe('detectImageType', () => {
  it('recognises jpeg, png and webp signatures', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpeg');
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(detectImageType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).toBe('webp');
  });

  it('rejects text, gif and truncated input', () => {
    expect(detectImageType(Buffer.from('hello world, not an image'))).toBeNull();
    expect(detectImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});
