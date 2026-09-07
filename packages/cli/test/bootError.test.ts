import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  anotherScenriLines,
  bootErrorLines,
  INSTALL_GUIDE,
  portBusyLines,
  shouldAdoptRunning,
} from '../src/bootError.js';

describe('portBusyLines', () => {
  it('names the port and offers the next one for both shells', () => {
    const text = portBusyLines(4747).join('\n');
    expect(text).toContain('Port 4747 is in use by another app.');
    expect(text).toContain('SCENRI_PORT=4748 npx scenri');
    expect(text).toContain('$env:SCENRI_PORT=4748; npx scenri');
  });

  it('suggests port+1 whatever the port', () => {
    expect(portBusyLines(5000).join('\n')).toContain('SCENRI_PORT=5001');
  });
});

describe('bootErrorLines', () => {
  it('generic failure: first message line, the guide, and the debug escape', () => {
    const text = bootErrorLines(new Error('listen EACCES: permission denied')).join('\n');
    expect(text).toContain('Scenri could not start: listen EACCES: permission denied');
    expect(text).toContain('npx scenri@latest');
    expect(text).toContain(INSTALL_GUIDE);
    expect(text).toContain('SCENRI_DEBUG=1');
  });

  it('keeps only the first line of a multi-line message', () => {
    const text = bootErrorLines(new Error('boom\n    at somewhere deep')).join('\n');
    expect(text).toContain('boom');
    expect(text).not.toContain('at somewhere');
  });

  it('ABI mismatch in the message reads as a native failure', () => {
    const text = bootErrorLines(
      new Error('was compiled against a different Node.js version using NODE_MODULE_VERSION 115'),
    ).join('\n');
    expect(text).toContain('a native component failed to load');
    expect(text).toContain('https://nodejs.org');
    expect(text).toContain('npx scenri@latest');
    expect(text).not.toContain(INSTALL_GUIDE);
  });

  it('ERR_DLOPEN_FAILED arrives as a code, not a message', () => {
    const err = Object.assign(new Error('cannot open shared object file'), {
      code: 'ERR_DLOPEN_FAILED',
    });
    expect(bootErrorLines(err).join('\n')).toContain('a native component failed to load');
  });

  it('a blocked install script leaves no bindings file', () => {
    const text = bootErrorLines(new Error('Could not locate the bindings file. Tried: ...')).join('\n');
    expect(text).toContain('a native component failed to load');
  });

  it('survives a non-Error throw', () => {
    expect(bootErrorLines('exploded').join('\n')).toContain('exploded');
  });

  it('every line obeys the copy rules: no long dashes, no exclamation, no emoji', () => {
    const all = [
      ...portBusyLines(4747),
      ...bootErrorLines(new Error('x')),
      ...bootErrorLines(new Error('NODE_MODULE_VERSION 115')),
    ].join('\n');
    expect(all).not.toMatch(/[–—]/);
    expect(all).not.toMatch(/!/);
    expect(all).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u);
  });
});

describe('shouldAdoptRunning', () => {
  const ours = mkdtempSync(join(tmpdir(), 'sc-home-'));
  const theirs = mkdtempSync(join(tmpdir(), 'sc-other-'));

  it('a source checkout adopts only a server on its own library', () => {
    expect(shouldAdoptRunning({ installKind: 'dev', ourHome: ours, theirHome: ours })).toBe(true);
    expect(shouldAdoptRunning({ installKind: 'dev', ourHome: ours, theirHome: theirs })).toBe(false);
  });

  it('compares real paths, so a home reached through a symlinked tmp still matches', () => {
    expect(shouldAdoptRunning({ installKind: 'dev', ourHome: join(ours, '.'), theirHome: `${ours}/` })).toBe(true);
  });

  it('built installs keep adopting, and so does a server too old to report its home', () => {
    expect(shouldAdoptRunning({ installKind: 'managed', ourHome: ours, theirHome: theirs })).toBe(true);
    expect(shouldAdoptRunning({ installKind: 'npx', ourHome: ours, theirHome: theirs })).toBe(true);
    expect(shouldAdoptRunning({ installKind: 'dev', ourHome: ours })).toBe(true);
  });
});

describe('anotherScenriLines', () => {
  it('names both libraries and offers the next port for a checkout', () => {
    const text = anotherScenriLines(4747, '/Users/x/.scenri', '/w/.scenri-home').join('\n');
    expect(text).toContain('Port 4747 is held by another Scenri, serving /Users/x/.scenri.');
    expect(text).toContain('would serve /w/.scenri-home');
    expect(text).toContain('SCENRI_PORT=4748 pnpm dev');
    expect(text).not.toMatch(/[–—]/);
    expect(text).not.toMatch(/!/);
  });
});
