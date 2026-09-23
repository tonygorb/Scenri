import { describe, it, expect } from 'vitest';
import { firewallVerdict, macVerdict, parseWindows, windowsScript } from '../src/network/firewall.js';

/** A socketfilterfw that answers each flag with the given text. */
const mac =
  (answers: Record<string, string>) =>
  async (_cmd: string, args: string[]): Promise<string> =>
    answers[args[0]] ?? '';

const NODE = '/Users/me/.nvm/versions/node/v24.18.0/bin/node';

describe('macVerdict', () => {
  it('a firewall that is off stands in nobody’s way', async () => {
    expect(await macVerdict(NODE, mac({ '--getglobalstate': 'Firewall is disabled. (State = 0)' }))).toBe('ok');
  });

  it('on, and node permitted', async () => {
    const exec = mac({
      '--getglobalstate': 'Firewall is enabled. (State = 1)',
      '--getblockall': 'Firewall has block all state set to disabled.',
      '--getappblocked': `Incoming connection to ${NODE} is permitted.`,
    });
    expect(await macVerdict(NODE, exec)).toBe('ok');
  });

  it('on, and node blocked', async () => {
    const exec = mac({
      '--getglobalstate': 'Firewall is enabled. (State = 1)',
      '--getblockall': 'Firewall has block all state set to disabled.',
      '--getappblocked': `Incoming connection to ${NODE} is blocked.`,
    });
    expect(await macVerdict(NODE, exec)).toBe('blocked');
  });

  it('on, and blocking every incoming connection', async () => {
    const exec = mac({
      '--getglobalstate': 'Firewall is enabled. (State = 2)',
      '--getblockall': 'Firewall has block all state set to enabled.',
    });
    expect(await macVerdict(NODE, exec)).toBe('blocked');
  });

  it('an answer it does not recognise says nothing specific', async () => {
    const exec = mac({
      '--getglobalstate': 'Firewall is enabled. (State = 1)',
      '--getblockall': 'Firewall has block all state set to disabled.',
      '--getappblocked': 'The application is not part of the firewall',
    });
    expect(await macVerdict(NODE, exec)).toBe('unknown');
  });
});

describe('parseWindows', () => {
  it('Private network, node allowed there', () => {
    expect(parseWindows('Private|True||Private')).toBe('ok');
    expect(parseWindows('Private|True||Any')).toBe('ok');
  });

  it('the firewall is off for this network', () => {
    expect(parseWindows('Public|False||')).toBe('ok');
  });

  // the Allow dialog ticks Private by default, and new Wi-Fi is Public
  it('Public network, node allowed only on private ones', () => {
    expect(parseWindows('Public|True||Private')).toBe('public-network');
  });

  it('Public network, allowed on both', () => {
    expect(parseWindows('Public|True||Private, Public')).toBe('ok');
  });

  // Cancel on the Allow dialog writes block rules, and block beats allow
  it('a block rule wins over an allow rule', () => {
    expect(parseWindows('Private|True|Private, Public|Private')).toBe('blocked');
  });

  it('no rule at all: the prompt was dismissed or never shown', () => {
    expect(parseWindows('Private|True||')).toBe('blocked');
  });

  it('reads the last line, whatever PowerShell printed before it', () => {
    expect(parseWindows('WARNING: something\r\nDomain|True||Domain\r\n')).toBe('ok');
  });

  it('anything else says nothing specific', () => {
    expect(parseWindows('')).toBe('unknown');
    expect(parseWindows('garbage')).toBe('unknown');
  });
});

describe('windowsScript', () => {
  it('names node by its path and quotes it for PowerShell', () => {
    const script = windowsScript("C:\\Users\\O'Neil\\node.exe");
    expect(script).toContain("-Program 'C:\\Users\\O''Neil\\node.exe'");
    expect(script).toContain('[Console]::OutputEncoding');
  });
});

describe('firewallVerdict', () => {
  it('Linux: unknown, the general advice shows', async () => {
    expect(await firewallVerdict({ platform: 'linux', exec: async () => 'x' })).toBe('unknown');
  });

  it('a probe that fails is unknown, never a crash', async () => {
    const exec = async () => {
      throw new Error('ENOENT');
    };
    expect(await firewallVerdict({ platform: 'darwin', exec })).toBe('unknown');
    expect(await firewallVerdict({ platform: 'win32', exec, env: {} })).toBe('unknown');
  });

  it('Windows runs PowerShell by its absolute path', async () => {
    let ran = '';
    await firewallVerdict({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      exec: async (cmd) => {
        ran = cmd;
        return 'Private|True||Private';
      },
    });
    expect(ran.toLowerCase()).toContain('powershell');
  });
});
