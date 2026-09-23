import { describe, it, expect } from 'vitest';
import {
  arrival,
  arrivalLine,
  helpLines,
  phoneLink,
  phoneRow,
  STUCK_AFTER_MS,
} from '../src/views/settings/phoneAccessRules.js';
import type { PhoneStatus } from '../src/api.js';

const status = (over: Partial<PhoneStatus> = {}): PhoneStatus => ({
  reach: 'network',
  thisComputer: true,
  platform: 'darwin',
  address: 'http://192.168.1.42:4747',
  url: 'http://192.168.1.42:4747/?t=K7P2QX',
  code: 'K7P2QX',
  others: [],
  problem: null,
  lastVisit: null,
  ...over,
});

describe('phoneRow', () => {
  it('shows nothing to press until the server has answered', () => {
    expect(phoneRow(null)).toEqual({ sentence: "Checking this computer's network.", action: null });
  });

  it('offers the QR code when a phone could open it', () => {
    expect(phoneRow(status())).toEqual({
      sentence: 'Use Scenri on a phone, tablet or another computer on the same Wi-Fi.',
      action: 'show',
    });
  });

  it('never shows an address that cannot open: no network means check again', () => {
    const row = phoneRow(status({ address: null, url: null, problem: 'no-network' }));
    expect(row.sentence).toContain('Connect this computer to Wi-Fi');
    expect(row.action).toBe('check');
  });

  it('says so when every address refused', () => {
    expect(phoneRow(status({ address: null, url: null, problem: 'blocked' })).action).toBe('check');
  });

  it('names the command-line switch when Scenri was kept to this computer', () => {
    const row = phoneRow(status({ reach: 'this-computer', address: null, url: null }));
    expect(row.sentence).toContain('SCENRI_HOST');
    expect(row.action).toBeNull();
  });

  it('a failed read offers another try', () => {
    expect(phoneRow(null, true).action).toBe('check');
  });
});

describe('the link', () => {
  // the QR code, Copy link and the terminal all carry the server's one url
  it('is exactly the server url, code included', () => {
    expect(phoneLink(status())).toBe('http://192.168.1.42:4747/?t=K7P2QX');
  });
});

describe('arrival', () => {
  const shown = 1_000_000;

  it('waits, then gives up waiting after half a minute', () => {
    expect(arrival(status(), shown, shown + 1000)).toBe('waiting');
    expect(arrival(status(), shown, shown + STUCK_AFTER_MS)).toBe('stuck');
  });

  it('connects the moment a device opens it', () => {
    const s = status({ lastVisit: { at: shown + 4000, device: 'iPhone' } });
    expect(arrival(s, shown, shown + 5000)).toBe('connected');
    expect(arrivalLine('connected', s)).toBe('Connected. Scenri opened on your iPhone.');
  });

  it('a visit from long before the code went up does not count', () => {
    const s = status({ lastVisit: { at: shown - 60 * 60_000, device: 'iPhone' } });
    expect(arrival(s, shown, shown + 1000)).toBe('waiting');
  });

  it('says what it is doing', () => {
    expect(arrivalLine('waiting', status())).toBe('Waiting for your phone…');
    expect(arrivalLine('stuck', status())).toBe('No phone has opened it yet.');
  });
});

describe('helpLines', () => {
  it('names a Mac firewall that blocks node, first', () => {
    const lines = helpLines('blocked', status({ platform: 'darwin' }));
    expect(lines[0]).toContain("Your Mac's firewall is blocking Scenri");
    expect(lines.join(' ')).not.toContain('asks whether node');
  });

  it('names Windows Firewall, and a Wi-Fi Windows calls public', () => {
    expect(helpLines('blocked', status({ platform: 'win32' }))[0]).toContain('Windows Firewall is blocking Scenri');
    expect(helpLines('public-network', status({ platform: 'win32' }))[0]).toContain(
      'Windows treats this Wi-Fi as public',
    );
  });

  it('without a reading, the general firewall line', () => {
    const lines = helpLines('unknown', status({ platform: 'linux' }));
    expect(lines.join(' ')).toContain('asks whether node may accept incoming connections');
  });

  it('a clear firewall leaves the Wi-Fi and the phone', () => {
    const lines = helpLines('ok', status());
    expect(lines[0]).toContain('same Wi-Fi');
    expect(lines.join(' ')).not.toContain('firewall');
  });

  it('offers the other addresses last', () => {
    const lines = helpLines('ok', status({ others: ['http://10.0.0.5:4747'] }));
    expect(lines.at(-1)).toBe('Or try http://10.0.0.5:4747.');
  });

  it('every line obeys the copy rules', () => {
    const all = [
      ...helpLines('blocked', status({ platform: 'darwin' })),
      ...helpLines('blocked', status({ platform: 'win32' })),
      ...helpLines('public-network', status()),
      ...helpLines('unknown', status({ others: ['http://10.0.0.5:4747'] })),
      phoneRow(null).sentence,
      phoneRow(status()).sentence,
      phoneRow(status({ problem: 'no-network', url: null })).sentence,
      phoneRow(status({ problem: 'blocked', url: null })).sentence,
      phoneRow(status({ reach: 'this-computer' })).sentence,
    ].join('\n');
    expect(all).not.toMatch(/[–—]/);
    expect(all).not.toMatch(/!/);
    expect(all).not.toMatch(/\bLAN\b|0\.0\.0\.0|bind/i);
  });
});
