import { spawnSync } from 'child_process';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { getEncryptionKey } from '../src/config';

describe('ENCRYPTION_KEY', () => {
  const original = process.env.ENCRYPTION_KEY;
  afterEach(() => {
    process.env.ENCRYPTION_KEY = original;
  });

  it('accepts 32 bytes of base64', () => {
    expect(getEncryptionKey()).toHaveLength(32);
  });

  it('rejects a missing or wrong-length key', () => {
    process.env.ENCRYPTION_KEY = '';
    expect(() => getEncryptionKey()).toThrow();
    process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(() => getEncryptionKey()).toThrow();
    process.env.ENCRYPTION_KEY = 'not base64!';
    expect(() => getEncryptionKey()).toThrow();
  });

  it('the app refuses to start without a valid key', () => {
    const root = path.resolve(__dirname, '..');
    const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    for (const key of ['', Buffer.alloc(31).toString('base64')]) {
      const result = spawnSync(process.execPath, [tsx, 'src/index.ts'], {
        cwd: root,
        env: { ...process.env, ENCRYPTION_KEY: key, PORT: '0' },
        encoding: 'utf8',
        timeout: 30000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Refusing to start');
    }
  }, 60000);
});
