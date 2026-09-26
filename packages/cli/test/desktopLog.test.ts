import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, closeSync, statSync, chmodSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendLog, openLogFd } from '../src/desktop/log.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sc-dlog-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('appendLog', () => {
  it('creates the directory and stamps each line', () => {
    const path = join(root, 'logs', 'launcher.log');
    appendLog(path, 'launcher invoked');
    appendLog(path, 'server already running');
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z launcher invoked$/);
    expect(lines[1]).toMatch(/server already running$/);
  });

  it('rotates a file past the cap into .1 instead of growing forever', () => {
    const path = join(root, 'launcher.log');
    writeFileSync(path, 'x'.repeat(100));
    appendLog(path, 'after cap', { maxBytes: 50 });
    expect(readFileSync(`${path}.1`, 'utf8')).toBe('x'.repeat(100));
    expect(readFileSync(path, 'utf8')).toMatch(/after cap\n$/);
  });

  it('never throws: an unwritable target is a lost line, not a failed launch', () => {
    // A plain file where the log directory should be makes both mkdir and
    // append fail; the launch that wanted to log must not fail with them.
    writeFileSync(join(root, 'blocker'), '');
    expect(() => appendLog(join(root, 'blocker', 'launcher.log'), 'hi')).not.toThrow();
  });
});

describe('openLogFd', () => {
  it('hands back an append descriptor for a server to inherit, rotating first when needed', () => {
    const path = join(root, 'scenri.log');
    writeFileSync(path, 'old'.repeat(10));
    const fd = openLogFd(path, { maxBytes: 10 });
    expect(typeof fd).toBe('number');
    writeFileSync(fd, 'fresh\n');
    closeSync(fd);
    expect(readFileSync(path, 'utf8')).toBe('fresh\n');
    expect(existsSync(`${path}.1`)).toBe(true);
  });
});

// The server's log carries what it prints, and the launcher's what it tried:
// neither is another local user's to read. Windows ignores these modes.
describe.skipIf(process.platform === 'win32')('who can read the logs', () => {
  const mode = (p: string) => statSync(p).mode & 0o777;

  it('makes the folder and each log private to their owner', () => {
    const logs = join(root, 'logs');
    appendLog(join(logs, 'launcher.log'), 'launcher invoked');
    closeSync(openLogFd(join(logs, 'scenri.log')));
    expect(mode(logs)).toBe(0o700);
    expect(mode(join(logs, 'launcher.log'))).toBe(0o600);
    expect(mode(join(logs, 'scenri.log'))).toBe(0o600);
  });

  it('tightens logs an older build left readable', () => {
    const logs = join(root, 'logs');
    for (const name of ['launcher.log', 'scenri.log']) {
      appendLog(join(logs, name), 'before');
    }
    chmodSync(logs, 0o755);
    chmodSync(join(logs, 'launcher.log'), 0o644);
    chmodSync(join(logs, 'scenri.log'), 0o644);
    appendLog(join(logs, 'launcher.log'), 'after');
    closeSync(openLogFd(join(logs, 'scenri.log')));
    expect(mode(logs)).toBe(0o700);
    expect(mode(join(logs, 'launcher.log'))).toBe(0o600);
    expect(mode(join(logs, 'scenri.log'))).toBe(0o600);
  });
});

describe('a start from the desktop icon', () => {
  const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
  let child: ChildProcess | null = null;

  afterEach(async () => {
    const c = child;
    child = null;
    if (c && c.exitCode === null) {
      c.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        c.once('exit', () => resolve());
        setTimeout(() => {
          c.kill('SIGKILL');
          resolve();
        }, 8000).unref();
      });
    }
  });

  /** A port nothing on this machine holds right now. */
  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });

  const answers = async (port: number, path: string): Promise<any | null> => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };

  it('never writes the phone access code into scenri.log (SEC-H13)', async (ctx) => {
    const port = await freePort();
    const log = join(root, 'scenri.log');
    // the descriptor desktop/open.ts hands the server: its stdout and stderr are the log
    const fd = openLogFd(log);
    // no SCENRI_HOST, as a desktop start has none: loopback plus a listener per Wi-Fi address
    const { SCENRI_HOST: _host, ...withoutHost } = process.env;
    child = spawn(process.execPath, ['--import', 'tsx', 'packages/cli/src/index.ts', 'serve'], {
      cwd: ROOT,
      stdio: ['ignore', fd, fd],
      env: {
        ...withoutHost,
        SCENRI_HEADLESS: '1',
        SCENRI_NO_OPEN: '1',
        SCENRI_PORT: String(port),
        SCENRI_HOME: join(root, 'lib'),
        SCENRI_NO_UPDATE_CHECK: '1',
        SCENRI_NO_GUIDE: '1',
        SCENRI_NO_CONTENT_FETCH: '1',
        SCENRI_NO_CODEX: '1',
        SCENRI_NO_DESKTOP: '1',
        OPENROUTER_API_KEY: '',
        REPLICATE_API_TOKEN: '',
        FAL_KEY: '',
      },
    });
    closeSync(fd);
    let phone: { code: string; address: string | null } | null = null;
    let serving: string | undefined;
    for (let i = 0; i < 150 && !phone; i++) {
      serving = (await answers(port, '/api/version'))?.home;
      phone = serving ? await answers(port, '/api/phone') : null;
      if (!phone) await new Promise((r) => setTimeout(r, 200));
    }
    expect(phone, 'the headless server never answered').not.toBeNull();
    expect(serving, 'another server holds the port').toBe(join(root, 'lib'));
    // with no Wi-Fi address there is no phone line to write, so nothing to check
    if (!phone?.address) return ctx.skip();
    // the banner lands after listen; give it a moment to be written
    for (let i = 0; i < 50 && !readFileSync(log, 'utf8').includes('data dir'); i++)
      await new Promise((r) => setTimeout(r, 100));
    const text = readFileSync(log, 'utf8');
    expect(text, 'the banner reached the log at all').toContain('data dir');
    const grouped = `${phone.code.slice(0, 3)} ${phone.code.slice(3)}`;
    expect(text.includes(grouped) || text.includes(phone.code), 'the code is in scenri.log').toBe(false);
    // the phone line is still there, pointing at Settings for the code
    expect(text).toContain('code in Settings');
  }, 60_000);
});
