import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAC_SCRIPT } from '../src/desktop/macos.js';

/**
 * The bundle's main executable, run by /bin/sh the way Finder runs it, with
 * HOME pointed at a scratch dir and a stub node that records every call.
 * A click must cost no probing when the recorded node still exists.
 */

let root: string;
let support: string;
let calls: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sc-script-'));
  support = join(root, '.scenri', 'launcher');
  mkdirSync(support, { recursive: true });
  writeFileSync(join(support, 'launch.mjs'), '// bootstrap');
  calls = join(root, 'calls');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A node that logs its argv, answers a version probe, and exits. */
function stubNode(path: string, major: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\nif [ "$1" = "-p" ]; then echo ${major}; fi\n`);
  chmodSync(path, 0o755);
}

function run(env: Record<string, string> = {}) {
  const script = join(root, 'Scenri');
  writeFileSync(script, MAC_SCRIPT);
  chmodSync(script, 0o755);
  return spawnSync('/bin/sh', [script], {
    encoding: 'utf8',
    env: { HOME: root, PATH: '/usr/bin:/bin', SCENRI_NO_DIALOG: '1', ...env },
  });
}
const recorded = () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []);

describe.skipIf(process.platform === 'win32')('the macOS bundle script', () => {
  it('runs the recorded node straight away, probing nothing', () => {
    stubNode(join(root, 'node'), '24');
    writeFileSync(join(support, 'node-path'), `${join(root, 'node')}\n`);
    writeFileSync(join(support, 'node-major'), '24\n');
    const res = run();
    expect(res.status).toBe(0);
    expect(recorded()).toEqual([join(support, 'launch.mjs')]);
  });

  it('falls back to a node of the recorded major when the recorded one is gone', () => {
    // 99 so no real node on this machine can match; the stub answers 99
    stubNode(join(root, '.volta', 'bin', 'node'), '99');
    writeFileSync(join(support, 'node-path'), `${join(root, 'gone', 'node')}\n`);
    writeFileSync(join(support, 'node-major'), '99\n');
    const res = run();
    expect(res.status).toBe(0);
    const seen = recorded();
    expect(seen[seen.length - 1]).toBe(join(support, 'launch.mjs'));
    expect(seen.some((l) => l.startsWith('-p '))).toBe(true);
  });

  it('says the launcher files are missing instead of failing inside node', () => {
    rmSync(join(support, 'launch.mjs'));
    stubNode(join(root, 'node'), '24');
    writeFileSync(join(support, 'node-path'), `${join(root, 'node')}\n`);
    const res = run();
    expect(res.status).toBe(1);
    expect(recorded()).toEqual([]);
  });
});
