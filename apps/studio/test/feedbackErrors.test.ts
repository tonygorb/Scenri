import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearErrors, installErrorHooks, recentErrors, recordError } from '../src/feedback/errors.js';
import { readEnvironment } from '../src/feedback/env.js';

beforeEach(() => {
  clearErrors();
});

describe('error ring', () => {
  it('keeps the newest 25 and drops the oldest', () => {
    for (let i = 0; i < 30; i++) recordError({ kind: 'api', message: `e${i}` });
    const got = recentErrors();
    expect(got).toHaveLength(25);
    expect(got[0].message).toBe('e5');
    expect(got.at(-1)?.message).toBe('e29');
  });

  it('scrubs on the way in, not on the way out', () => {
    recordError({
      kind: 'api',
      message: 'ENOENT /Users/tonygorb/.scenri',
      url: '/api/x?t=Xy9ABCDEFGHIJKLMNOPQRSTUVwxyz12',
    });
    const [e] = recentErrors();
    expect(e.message).not.toContain('tonygorb');
    expect(e.url).not.toContain('Xy9');
  });

  it('clips a long message rather than carrying a whole stack', () => {
    recordError({ kind: 'window', message: 'x'.repeat(500) });
    expect(recentErrors()[0].message.length).toBeLessThanOrEqual(301);
  });

  it('hands back a copy, so a report cannot change after it is built', () => {
    recordError({ kind: 'api', message: 'one' });
    const snapshot = recentErrors();
    recordError({ kind: 'api', message: 'two' });
    expect(snapshot).toHaveLength(1);
  });

  it('captures window errors and rejections, and removes its listeners', () => {
    const uninstall = installErrorHooks();
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'http://h/a.js?t=zz' }));
    expect(recentErrors().at(-1)?.message).toBe('boom');
    expect(recentErrors().at(-1)?.url).not.toContain('t=zz');

    uninstall();
    window.dispatchEvent(new ErrorEvent('error', { message: 'after' }));
    expect(recentErrors().some((e) => e.message === 'after')).toBe(false);
  });
});

describe('environment', () => {
  /** jsdom has no matchMedia; the app assumes it everywhere, so stub it. */
  const media = (map: Record<string, boolean>) => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: map[q] ?? false }) as MediaQueryList);
  };

  it('classifies the device the same way tokens.css does', () => {
    media({ '(max-width: 767px)': true, '(pointer: coarse)': true });
    expect(readEnvironment().device).toBe('phone');
    // a tablet is coarse but wide: the touch rules hang off pointer, not width
    media({ '(max-width: 767px)': false, '(pointer: coarse)': true });
    expect(readEnvironment().device).toBe('tablet');
    media({ '(max-width: 767px)': false, '(pointer: coarse)': false });
    expect(readEnvironment().device).toBe('desktop');
  });

  it('collects a viewport, not a fingerprint', () => {
    media({});
    const env = readEnvironment();
    expect(env.viewport.w).toBeGreaterThan(0);
    expect(env.build).toBe('test');
    // no canvas hash, no font list, no plugin enumeration, no IP
    expect(Object.keys(env).sort()).toEqual(
      ['at', 'browser', 'build', 'device', 'dpr', 'language', 'online', 'os', 'theme', 'viewport'].sort(),
    );
  });
});
