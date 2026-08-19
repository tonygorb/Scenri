import { describe, it, expect } from 'vitest';
import { parseArgs, helpText } from '../src/args.js';

describe('argv dispatcher', () => {
  it('no arguments means launch (supervised default)', () => {
    expect(parseArgs([])).toEqual({ cmd: 'launch' });
  });

  it('serve runs this build in-process, unsupervised', () => {
    expect(parseArgs(['serve'])).toEqual({ cmd: 'serve' });
  });

  it('update stages the newest version', () => {
    expect(parseArgs(['update'])).toEqual({ cmd: 'update', check: false, from: undefined });
  });

  it('update --check only checks, never stages', () => {
    expect(parseArgs(['update', '--check'])).toEqual({ cmd: 'update', check: true, from: undefined });
  });

  it('update --from takes a tarball or spec', () => {
    expect(parseArgs(['update', '--from', './scenri-99.0.0.tgz'])).toEqual({
      cmd: 'update',
      check: false,
      from: './scenri-99.0.0.tgz',
    });
  });

  it('update --from without a value is an error', () => {
    expect(parseArgs(['update', '--from'])).toEqual({ cmd: 'error', message: '--from requires a value' });
  });

  it('verify is the hidden staged-install probe', () => {
    expect(parseArgs(['verify'])).toEqual({ cmd: 'verify' });
  });

  it.each([['--version'], ['-v']])('%s prints the version', (flag) => {
    expect(parseArgs([flag])).toEqual({ cmd: 'version' });
  });

  it.each([['--help'], ['-h']])('%s prints usage', (flag) => {
    expect(parseArgs([flag])).toEqual({ cmd: 'help' });
  });

  it('an unknown command is an error naming the argument', () => {
    expect(parseArgs(['deploy'])).toEqual({ cmd: 'error', message: "unknown command 'deploy' (try --help)" });
  });

  it('an unknown flag on update is an error', () => {
    expect(parseArgs(['update', '--force'])).toEqual({
      cmd: 'error',
      message: "unknown option '--force' (try --help)",
    });
  });

  it('help text names every public command and no hidden ones', () => {
    const t = helpText();
    for (const cmd of ['serve', 'update', '--check', '--version', '--help']) expect(t).toContain(cmd);
    expect(t).not.toContain('verify');
  });
});
