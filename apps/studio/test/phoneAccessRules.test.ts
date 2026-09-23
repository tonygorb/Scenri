import { describe, it, expect } from 'vitest';
import {
  allowLine,
  arrival,
  firewallNotice,
  groupCode,
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
  url: 'http://192.168.1.42:4747/?t=482913',
  code: '482913',
  others: [],
  problem: null,
  lastVisit: null,
  ...over,
});

describe('phoneRow', () => {
  it('shows nothing to press until the server has answered', () => {
    expect(phoneRow(null)).toEqual({ sentence: "Checking this computer's network.", action: null });
  });

  it('offers the link when a phone could open it, the code standing under the row', () => {
    expect(phoneRow(status())).toEqual({
      sentence: "Point your phone's camera at the code, or copy the link for another computer.",
      action: 'copy',
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
    expect(phoneLink(status())).toBe('http://192.168.1.42:4747/?t=482913');
  });

  it('shows the code the way it is read and typed: two groups of three', () => {
    expect(groupCode('482913')).toBe('482 913');
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

describe('firewallNotice', () => {
  it('a Mac firewall that blocks node: said up front, with the fix', () => {
    expect(firewallNotice('blocked', 'darwin')).toEqual({
      text: "Your Mac's firewall is blocking Scenri, so your phone cannot open it yet.",
      canAllow: true,
    });
  });

  it('Windows Firewall on this network, Public or Cancelled alike: the same one fix', () => {
    const n = firewallNotice('blocked', 'win32');
    expect(n?.text).toContain('Windows Firewall is blocking Scenri on this network');
    expect(n?.canAllow).toBe(true);
  });

  it('a Mac blocking every connection: the way to undo it, no button', () => {
    const n = firewallNotice('blocks-all', 'darwin');
    expect(n?.text).toContain('Block all incoming connections');
    expect(n?.canAllow).toBe(false);
  });

  it('nothing to say when the firewall is fine, unread, or unknown', () => {
    expect(firewallNotice('ok', 'darwin')).toBeNull();
    expect(firewallNotice(null, 'win32')).toBeNull();
    expect(firewallNotice('unknown', 'linux')).toBeNull();
  });
});

describe('allowLine', () => {
  it('says whose prompt to answer while it waits', () => {
    expect(allowLine('asking', 'darwin')).toBe('Enter your Mac password to allow Scenri.');
    expect(allowLine('asking', 'win32')).toBe('Choose Yes when Windows asks to allow Scenri.');
  });

  it('says how it ended', () => {
    expect(allowLine('done', 'darwin')).toBe('Allowed. Scan the code again.');
    expect(allowLine('cancelled', 'win32')).toBe('Nothing changed. Press Allow Scenri to try again.');
    expect(allowLine('failed', 'darwin')).toContain('System Settings, Network, Firewall, Options');
    expect(allowLine('failed', 'win32')).toContain('Allow an app through firewall');
    expect(allowLine('idle', 'darwin')).toBeNull();
  });
});

describe('helpLines', () => {
  it('leads with the Wi-Fi, since a firewall it could read is named above', () => {
    const lines = helpLines('blocked', status());
    expect(lines[0]).toContain('same Wi-Fi');
    expect(lines.join(' ')).not.toContain('firewall');
    expect(lines.join(' ')).not.toContain('asks whether node');
  });

  it('without a reading, the general firewall line', () => {
    expect(helpLines('unknown', status({ platform: 'linux' })).join(' ')).toContain(
      'asks whether node may accept incoming connections',
    );
    expect(helpLines(null, status()).join(' ')).toContain('asks whether node');
  });

  it('offers the other addresses last', () => {
    const lines = helpLines('ok', status({ others: ['http://10.0.0.5:4747'] }));
    expect(lines.at(-1)).toBe('Or try http://10.0.0.5:4747.');
  });

  it('every line obeys the copy rules', () => {
    const all = [
      ...helpLines('unknown', status({ others: ['http://10.0.0.5:4747'] })),
      ...(['blocked', 'blocks-all'] as const).flatMap((v) =>
        ['darwin', 'win32'].map((p) => firewallNotice(v, p)?.text ?? ''),
      ),
      ...(['asking', 'done', 'cancelled', 'failed'] as const).flatMap((st) =>
        ['darwin', 'win32'].map((p) => allowLine(st, p) ?? ''),
      ),
      phoneRow(null).sentence,
      phoneRow(status()).sentence,
      phoneRow(status({ problem: 'no-network', url: null })).sentence,
      phoneRow(status({ problem: 'blocked', url: null })).sentence,
      phoneRow(status({ reach: 'this-computer' })).sentence,
    ].join('\n');
    expect(all).not.toMatch(/[\u2013\u2014]/);
    expect(all).not.toMatch(/!/);
    expect(all).not.toMatch(/\bLAN\b|0\.0\.0\.0|bind/i);
  });
});
