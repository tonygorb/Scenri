import { describe, it, expect } from 'vitest';
import {
  allowScenri,
  firewallVerdict,
  macAllowArgs,
  macVerdict,
  parseWindows,
  windowsAllowScript,
  windowsElevate,
  windowsScript,
} from '../src/network/firewall.js';

/** A socketfilterfw that answers each flag with the given text. */
const mac =
  (answers: Record<string, string>) =>
  async (_cmd: string, args: string[]): Promise<string> =>
    answers[args[0]] ?? '';

const NODE = '/Users/me/.nvm/versions/node/v24.18.0/bin/node';
const ON = {
  '--getglobalstate': 'Firewall is enabled. (State = 1)',
  '--getblockall': 'Firewall has block all state set to disabled.',
};

describe('macVerdict', () => {
  it('a firewall that is off stands in nobody’s way', async () => {
    expect(await macVerdict(NODE, mac({ '--getglobalstate': 'Firewall is disabled. (State = 0)' }))).toBe('ok');
  });

  it('on, and node permitted (a signed node is, by default)', async () => {
    const exec = mac({ ...ON, '--getappblocked': `Incoming connection to ${NODE} is permitted.` });
    expect(await macVerdict(NODE, exec)).toBe('ok');
  });

  it('on, and node denied at the prompt: blocked, which Allow fixes', async () => {
    const exec = mac({ ...ON, '--getappblocked': `Incoming connection to ${NODE} is blocked.` });
    expect(await macVerdict(NODE, exec)).toBe('blocked');
  });

  it('on, and blocking every incoming connection: the person’s own setting', async () => {
    const exec = mac({
      '--getglobalstate': 'Firewall is enabled. (State = 2)',
      '--getblockall': 'Firewall has block all state set to enabled.',
    });
    expect(await macVerdict(NODE, exec)).toBe('blocks-all');
  });

  it('an answer it does not recognise says nothing specific', async () => {
    const exec = mac({ ...ON, '--getappblocked': 'The application is not part of the firewall' });
    expect(await macVerdict(NODE, exec)).toBe('unknown');
  });
});

describe('parseWindows', () => {
  it('Private network, node allowed there', () => {
    expect(parseWindows('Private|True||Private|False')).toBe('ok');
    expect(parseWindows('Private|True||Any|False')).toBe('ok');
  });

  it('the firewall is off for this network', () => {
    expect(parseWindows('Public|False|||False')).toBe('ok');
  });

  // the Allow dialog ticks Private by default, and a new Wi-Fi is Public
  it('Public network, node allowed only on private ones: blocked', () => {
    expect(parseWindows('Public|True||Private|False')).toBe('blocked');
  });

  it('Scenri’s own port rule lets it in on any network', () => {
    expect(parseWindows('Public|True||Private|True')).toBe('ok');
  });

  // Cancel on the dialog writes block rules, and block beats every allow
  it('a block rule wins, even over Scenri’s own rule', () => {
    expect(parseWindows('Private|True|Private, Public|Private|True')).toBe('blocked');
  });

  it('no rule at all: the prompt was dismissed or never shown', () => {
    expect(parseWindows('Private|True|||False')).toBe('blocked');
  });

  it('reads the last line, whatever PowerShell printed before it', () => {
    expect(parseWindows('WARNING: something\r\nDomain|True||Domain|False\r\n')).toBe('ok');
  });

  it('anything else says nothing specific', () => {
    expect(parseWindows('')).toBe('unknown');
    expect(parseWindows('garbage')).toBe('unknown');
  });
});

describe('windowsScript', () => {
  it('names node by its path, quoted for PowerShell, and asks after Scenri’s own rule', () => {
    const script = windowsScript("C:\\Users\\O'Neil\\node.exe", 4747);
    expect(script).toContain("-Program 'C:\\Users\\O''Neil\\node.exe'");
    expect(script).toContain("-Name 'Scenri-4747'");
    expect(script).toContain('[Console]::OutputEncoding');
  });
});

describe('the fix', () => {
  it('Windows: drops node’s block rules, then allows the port from the local subnet only', () => {
    const script = windowsAllowScript('C:\\nodejs\\node.exe', 4750);
    const drop = script.indexOf('Remove-NetFirewallRule;');
    const add = script.indexOf('New-NetFirewallRule');
    expect(drop).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(drop);
    expect(script).toContain("-Program 'C:\\nodejs\\node.exe'");
    expect(script).toContain("$_.Action -eq 'Block'");
    expect(script).toContain('-LocalPort 4750');
    expect(script).toContain('-RemoteAddress LocalSubnet');
    expect(script).toContain('-Direction Inbound -Action Allow -Protocol TCP');
  });

  it('Windows: goes through UAC with the script encoded, so no path breaks the quoting', () => {
    const args = windowsElevate('C:\\it’s here\\node.exe', 4750, { SystemRoot: 'C:\\Windows' });
    const cmd = args.at(-1) ?? '';
    expect(cmd).toContain('-Verb RunAs -Wait -PassThru');
    expect(cmd).toContain('catch { exit 1223 }');
    const b64 = cmd.match(/'-EncodedCommand','([^']+)'/)?.[1] ?? '';
    expect(Buffer.from(b64, 'base64').toString('utf16le')).toBe(windowsAllowScript('C:\\it’s here\\node.exe', 4750));
  });

  it('macOS: the path travels as an argument, never inside the script', () => {
    const args = macAllowArgs('/opt/homebrew/bin/node');
    expect(args.at(-1)).toBe('/opt/homebrew/bin/node');
    expect(args.join(' ')).toContain(
      '--add " & p & " && /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp " & p',
    );
    expect(args.join(' ')).toContain('with administrator privileges');
    expect(args.slice(0, -1).join(' ')).not.toContain('/opt/homebrew');
  });

  it('done, cancelled or failed, as the prompt ended', async () => {
    const ok = async () => '';
    expect(await allowScenri({ port: 4747, platform: 'darwin', exec: ok })).toBe('done');
    expect(await allowScenri({ port: 4747, platform: 'win32', exec: ok, env: {} })).toBe('done');
    const macCancel = async () => {
      throw Object.assign(new Error('Command failed'), { code: 1, stderr: 'execution error: User canceled. (-128)' });
    };
    expect(await allowScenri({ port: 4747, platform: 'darwin', exec: macCancel })).toBe('cancelled');
    const uacNo = async () => {
      throw Object.assign(new Error('Command failed'), { code: 1223 });
    };
    expect(await allowScenri({ port: 4747, platform: 'win32', exec: uacNo, env: {} })).toBe('cancelled');
    const broke = async () => {
      throw Object.assign(new Error('Command failed'), { code: 1 });
    };
    expect(await allowScenri({ port: 4747, platform: 'win32', exec: broke, env: {} })).toBe('failed');
    expect(await allowScenri({ port: 4747, platform: 'linux', exec: ok })).toBe('unsupported');
  });
});

describe('firewallVerdict', () => {
  it('Linux: unknown, the general advice shows', async () => {
    expect(await firewallVerdict({ port: 4747, platform: 'linux', exec: async () => 'x' })).toBe('unknown');
  });

  it('a probe that fails is unknown, never a crash', async () => {
    const exec = async () => {
      throw new Error('ENOENT');
    };
    expect(await firewallVerdict({ port: 4747, platform: 'darwin', exec })).toBe('unknown');
    expect(await firewallVerdict({ port: 4747, platform: 'win32', exec, env: {} })).toBe('unknown');
  });

  it('Windows runs PowerShell by its absolute path', async () => {
    let ran = '';
    await firewallVerdict({
      port: 4747,
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      exec: async (cmd) => {
        ran = cmd;
        return 'Private|True||Private|False';
      },
    });
    expect(ran.toLowerCase()).toContain('powershell');
  });
});
