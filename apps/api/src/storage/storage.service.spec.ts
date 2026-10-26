import { join } from 'node:path';
import { StorageService } from './storage.service';

describe('StorageService.path', () => {
  const dir = '/srv/s2w-unit-test';
  process.env.DATA_DIR = dir;
  const storage = new StorageService();

  it.each(['../x', '/etc/passwd', 'a/../../b', '', 'a//b', 'a\\b', 'a/b c'])('rejects %p', (key) => {
    expect(() => storage.path(key)).toThrow('invalid storage key');
  });

  it('resolves generated keys under DATA_DIR', () => {
    expect(storage.path('projects/p1/uploads/x.jpg')).toBe(join(dir, 'projects/p1/uploads/x.jpg'));
  });
});
