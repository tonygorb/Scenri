import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, closeSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
