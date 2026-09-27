import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Closing the terminal window stops Scenri, the install guide says, and that
 * arrives as a hangup. Left to Node's default it ended the process on the spot,
 * skipping the drain Ctrl-C runs, so a Codex exec in its own session went on
 * drawing. POSIX only: Windows has no hangup to send a child process.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENTRY = join(REPO, 'packages', 'cli', 'src', 'index.ts');

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

let home = '';
afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('closing the terminal', () => {
  it.skipIf(process.platform === 'win32')(
    'drains Scenri the way Ctrl-C does, instead of ending it on the spot',
    async () => {
      home = mkdtempSync(join(tmpdir(), 'sc-hangup-'));
      const port = await freePort();
      const child = spawn(process.execPath, ['--import', 'tsx', ENTRY, 'serve'], {
        cwd: REPO,
        env: {
          ...process.env,
          SCENRI_HOME: home,
          SCENRI_PORT: String(port),
          SCENRI_HOST: '127.0.0.1',
          SCENRI_SUPERVISED: '',
          SCENRI_NO_OPEN: '1',
          SCENRI_NO_DESKTOP: '1',
          SCENRI_NO_UPDATE_CHECK: '1',
          SCENRI_NO_CONTENT_FETCH: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => {
        out += String(d);
      });
      child.stderr.on('data', (d) => {
        out += String(d);
      });
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
        child.on('exit', (code, signal) => resolve({ code, signal })),
      );
      for (let i = 0; i < 300; i++) {
        const up = await fetch(`http://127.0.0.1:${port}/api/version`)
          .then((r) => r.ok)
          .catch(() => false);
        if (up) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      child.kill('SIGHUP');
      expect(await exited, out).toEqual({ code: 0, signal: null });
    },
    60_000,
  );
});
