import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, closeSync } from 'node:fs';
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
