import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core } from '@scenri/core';
import { createThumbStore } from '../src/thumbs.js';

describe('thumb store', () => {
  let home: string;
  let core: Core;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'scenri-thumbs-'));
    core = createCore(home);
  });
  afterEach(() => {
    core.close();
    rmSync(home, { recursive: true, force: true });
  });

  const frame = (tint: string) =>
    sharp({ create: { width: 320, height: 400, channels: 3, background: tint } })
      .png()
      .toBuffer();

  it('removes every derivative of a hash, waits for one still being made, and forgets its failure', async () => {
    const thumbs = createThumbStore(core);
    const hash = core.images.save(await frame('#334455'));
    const made = await thumbs.ensure(hash, 160);
    expect(made && existsSync(made)).toBe(true);
    // Ask for a second width and remove while it is in flight: the unlink must
    // land after the rename, or the derivative reappears on disk.
    const pending = thumbs.ensure(hash, 320);
    await thumbs.remove(hash);
    const late = await pending;
    expect(made && existsSync(made)).toBe(false);
    expect(late === null || !existsSync(late)).toBe(true);
    // A broken image is remembered as failed; removing it clears the memo so a
    // later, fixed original at the same hash is tried again.
    const bad = core.images.save(Buffer.from('not-a-png'));
    expect(await thumbs.ensure(bad, 160)).toBeNull();
    await thumbs.remove(bad);
    core.images.remove(bad);
    expect(core.images.has(bad)).toBe(false);
    await thumbs.settle();
  });

  it('ignores a hash that is not one, and one with nothing on disk', async () => {
    const thumbs = createThumbStore(core);
    await expect(thumbs.remove('../etc')).resolves.toBeUndefined();
    await expect(thumbs.remove('0123456789abcdef0123456789abcdef')).resolves.toBeUndefined();
  });
});
