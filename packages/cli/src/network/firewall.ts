/**
 * Whether this computer's firewall is the reason a phone cannot open Scenri.
 *
 * Asked only when the studio's help is showing, never on a timer: both checks
 * are read-only questions to the operating system, but PowerShell takes a
 * second to start and there is no reason to pay that while things work.
 * Anything unexpected is "unknown", which shows the general advice rather
 * than a wrong specific one.
 */
import { execFile } from 'node:child_process';
import { PS_UTF8, powershellPath } from '../desktop/paths.js';

/**
 * - `blocked`: the firewall refuses incoming connections to node.
 * - `public-network`: Windows treats this Wi-Fi as public, and node is only allowed on private ones.
 * - `ok`: nothing here stands in the way.
 * - `unknown`: we could not tell (Linux, a failed probe, an answer we do not recognise).
 */
export type FirewallVerdict = 'blocked' | 'public-network' | 'ok' | 'unknown';

export type Run = (cmd: string, args: string[]) => Promise<string>;

const run: Run = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8', timeout: 8000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });

const SOCKETFILTERFW = '/usr/libexec/ApplicationFirewall/socketfilterfw';

/** macOS: the application firewall's own answers, which need no administrator to read. */
export async function macVerdict(nodePath: string, exec: Run = run): Promise<FirewallVerdict> {
  const state = await exec(SOCKETFILTERFW, ['--getglobalstate']);
  if (/disabled|State = 0/i.test(state)) return 'ok';
  if (!/enabled|State = [12]/i.test(state)) return 'unknown';
  const all = await exec(SOCKETFILTERFW, ['--getblockall']);
  if (/block all state set to enabled|State = 2/i.test(all)) return 'blocked';
  const app = await exec(SOCKETFILTERFW, ['--getappblocked', nodePath]);
  if (/is blocked/i.test(app)) return 'blocked';
  if (/is permitted/i.test(app)) return 'ok';
  return 'unknown';
}

/**
 * Windows: which profile this Wi-Fi is on, whether the firewall is on for it,
 * and which inbound rules name this node.exe. One line back, pipe separated,
 * so the parse is the only thing a test has to cover. Block rules win over
 * allow rules in Windows Firewall, which is why any block is a verdict.
 */
export function windowsScript(nodePath: string): string {
  const node = nodePath.replace(/'/g, "''");
  return [
    PS_UTF8,
    "$ErrorActionPreference='SilentlyContinue';",
    "$c=(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | Select-Object -First 1).NetworkCategory;",
    "$n=if ($c -eq 'DomainAuthenticated') { 'Domain' } else { \"$c\" };",
    '$on=(Get-NetFirewallProfile -Name $n).Enabled;',
    `$r=Get-NetFirewallApplicationFilter -Program '${node}' | Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' };`,
    "$b=@($r | Where-Object { $_.Action -eq 'Block' } | ForEach-Object { $_.Profile.ToString() }) -join ';';",
    "$a=@($r | Where-Object { $_.Action -eq 'Allow' } | ForEach-Object { $_.Profile.ToString() }) -join ';';",
    'Write-Output "$n|$on|$b|$a"',
  ].join(' ');
}

/** "Private, Public" or "Any" covers the named profile. */
const covers = (profiles: string, profile: string): boolean =>
  profiles
    .split(';')
    .filter(Boolean)
    .some((p) => /\bAny\b/i.test(p) || p.split(',').some((x) => x.trim().toLowerCase() === profile.toLowerCase()));

export function parseWindows(out: string): FirewallVerdict {
  const line = out.trim().split(/\r?\n/).pop() ?? '';
  const [profile, on, block = '', allow = ''] = line.split('|');
  if (!profile || !['Public', 'Private', 'Domain'].includes(profile)) return 'unknown';
  if (/^false$/i.test(on ?? '')) return 'ok';
  if (covers(block, profile)) return 'blocked';
  if (covers(allow, profile)) return 'ok';
  // node is allowed somewhere, just not on this kind of network
  if (profile === 'Public' && covers(allow, 'Private')) return 'public-network';
  // no rule at all: the prompt was dismissed, or never appeared
  return 'blocked';
}

export async function firewallVerdict(opts: {
  platform?: NodeJS.Platform;
  nodePath?: string;
  env?: NodeJS.ProcessEnv;
  exec?: Run;
}): Promise<FirewallVerdict> {
  const platform = opts.platform ?? process.platform;
  const nodePath = opts.nodePath ?? process.execPath;
  const exec = opts.exec ?? run;
  try {
    if (platform === 'darwin') return await macVerdict(nodePath, exec);
    if (platform === 'win32') {
      const out = await exec(powershellPath(opts.env ?? process.env), [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        windowsScript(nodePath),
      ]);
      return parseWindows(out);
    }
  } catch {
    /* the probe itself failed: say nothing specific */
  }
  return 'unknown';
}
