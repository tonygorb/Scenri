import { describe, it, expect } from 'vitest';
import { isBuiltEntry } from '../src/builtEntry.js';

describe('isBuiltEntry', () => {
  it('recognises a published POSIX install (the realpathed bin target)', () => {
    expect(isBuiltEntry('/Users/t/.npm/_npx/80dd2e9f/node_modules/scenri/dist/index.js')).toBe(true);
  });

  it('recognises a global install', () => {
    expect(isBuiltEntry('/usr/local/lib/node_modules/scenri/dist/index.js')).toBe(true);
  });

  it('recognises a Windows install path', () => {
    const win = ['C:', 'Users', 't', 'AppData', 'Roaming', 'npm', 'node_modules', 'scenri', 'dist', 'index.js'];
    expect(isBuiltEntry(win.join('\\'))).toBe(true);
  });

  it('recognises a staged managed version', () => {
    expect(isBuiltEntry('/Users/t/.scenri/app/versions/0.5.0/node_modules/scenri/dist/index.js')).toBe(true);
  });

  it('recognises a built checkout run directly', () => {
    expect(isBuiltEntry('/repo/packages/cli/dist/index.js')).toBe(true);
  });

  it('leaves a source checkout unsupervised (tsx, src/)', () => {
    expect(isBuiltEntry('/repo/packages/cli/src/index.ts')).toBe(false);
  });

  it('leaves the unresolved bin symlink path unsupervised', () => {
    // The old argv[1] shape. If this path ever reaches the predicate again,
    // falling back to plain serve is the safe answer, not the launcher.
    expect(isBuiltEntry('/Users/t/.npm/_npx/80dd2e9f/node_modules/.bin/scenri')).toBe(false);
  });
});
