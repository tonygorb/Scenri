import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { createCodexEngine } from '../src/index.js';
import type { BrandContext } from '@scenri/core';

const brand: BrandContext = { brand: {}, assetPaths: {} };

/**
 * Regression: codex exec streams a large transcript to stdout. If the adapter
 * doesn't drain stdout, the child blocks once the 64KB pipe buffer fills and
 * the run dies on timeout (reproduced live 2026-08-01). This uses a REAL child
 * process with real pipes: it floods >1MB to stdout, then writes out-1.png.
 */
describe('codex adapter stdout backpressure', () => {
  it('survives a child that floods stdout before producing images', async () => {
    const flood = [
      '-e',
      `const fs = require('fs');
       const dir = process.argv[1];
       const big = Buffer.from('x'.repeat(65536));
       for (let i = 0; i < 20; i++) fs.writeSync(1, big); // sync write BLOCKS when pipe unread, like codex (Rust)
       fs.writeFileSync(require('path').join(dir, 'out-1.png'), Buffer.from([0x89,0x50,0x4e,0x47]));
       process.exit(0);`,
    ];
    // redirect 'codex <args>' to 'node -e <flood> <workdir>'; workdir is the -C value
    const spawnImpl = ((_cmd: string, args: string[], opts?: object) => {
      const dirIdx = args.indexOf('-C') + 1;
      return spawn(process.execPath, [...flood, args[dirIdx]], opts as never);
    }) as typeof spawn;

    const saved: Buffer[] = [];
    const engine = createCodexEngine({
      platform: 'linux',
      saveImage: (b) => {
        saved.push(b);
        return `h${saved.length}`;
      },
      spawnImpl,
      timeoutMs: 8000,
    });
    const res = await engine.generate({ prompt: 'x', brand, width: 64, height: 64, count: 1 });
    expect(res.images).toEqual(['h1']);
  }, 15000);
});
