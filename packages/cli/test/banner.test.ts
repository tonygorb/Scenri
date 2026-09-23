import { describe, it, expect } from 'vitest';
import { localUrl, startLines } from '../src/banner.js';

const base = { host: '127.0.0.1', port: 4750, home: '/Users/me/.scenri', studioBuilt: true };

describe('startLines', () => {
  it('the studio on this computer, and where a phone finds it, on the real port', () => {
    const text = startLines({ ...base, phone: { address: 'http://192.168.1.42:4750', code: 'K7P2QX' } }).join('\n');
    expect(text).toContain('Scenri Studio → http://127.0.0.1:4750');
    expect(text).toContain('on your phone → http://192.168.1.42:4750  code K7P2QX');
    expect(text).toContain('data dir      → /Users/me/.scenri');
    expect(text).not.toContain('4747');
  });

  it('no phone line when no phone could open it', () => {
    const text = startLines({ ...base, phone: { address: null, code: 'K7P2QX' } }).join('\n');
    expect(text).not.toContain('on your phone');
    expect(startLines({ ...base, phone: null }).join('\n')).not.toContain('on your phone');
  });

  it('lines the arrows up', () => {
    const lines = startLines({ ...base, phone: { address: 'http://10.0.0.2:4750', code: 'K7P2QX' } });
    const cols = lines.filter((l) => l.includes('→')).map((l) => l.indexOf('→'));
    expect(new Set(cols).size).toBe(1);
  });

  it('every line obeys the copy rules: no long dashes, no exclamation, no emoji', () => {
    const all = [
      ...startLines({ ...base, phone: { address: 'http://192.168.1.42:4750', code: 'K7P2QX' } }),
      ...startLines({ ...base, studioBuilt: false, phone: null }),
    ].join('\n');
    expect(all).not.toMatch(/[–—]/);
    expect(all).not.toMatch(/!/);
    expect(all).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u);
  });
});

describe('localUrl', () => {
  it('the loopback for the default, a wildcard, or localhost', () => {
    for (const host of ['127.0.0.1', '0.0.0.0', '::', 'localhost']) {
      expect(localUrl(host, 4747, 'K7P2QX')).toBe('http://127.0.0.1:4747');
    }
    expect(localUrl('::1', 4747, 'K7P2QX')).toBe('http://[::1]:4747');
  });

  // bound to one named address, this computer is a device like any other
  it('one named address carries the code', () => {
    expect(localUrl('192.168.1.20', 4747, 'K7P2QX')).toBe('http://192.168.1.20:4747/?t=K7P2QX');
  });
});
