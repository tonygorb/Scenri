/**
 * Whether this computer's firewall stops a phone from opening Scenri, and the
 * one fix a person can approve with a click.
 *
 * Read-only questions first, asked when the QR code opens, never on a timer.
 * The fix runs only when the person presses Allow, and goes through the
 * operating system's own prompt (a password on macOS, UAC on Windows), the
 * way LAN apps are expected to: nothing is changed behind anyone's back.
 *
 * macOS. Node from nodejs.org is signed, and the firewall lets signed software
 * in by default; a Homebrew or self-built node may have been denied at the
 * prompt. The fix is the firewall's own two commands, the same pair Node's
 * test tooling uses: --add, then --unblockapp.
 *
 * Windows. The prompt node.exe raises on its first listen writes a Block rule
 * when Cancel is pressed, and a Block rule beats every Allow rule; a network
 * Windows calls Public is blocked when only Private was ticked. So the fix
 * removes the inbound Block rules on this node.exe, then allows Scenri's port
 * from the local subnet only, on every profile. The port, not the program,
 * because a node update moves the program and would strand the rule.
 */
import { execFile } from 'node:child_process';
import { PS_UTF8, powershellPath } from '../desktop/paths.js';

/**
 * - `blocked`: the firewall refuses a phone, and Allow can fix it.
 * - `blocks-all`: macOS is set to block every incoming connection, which is the person's choice to undo.
 * - `ok`: nothing here stands in the way.
 * - `unknown`: we could not tell (Linux, a failed probe, an answer we do not recognise).
 */
export type FirewallVerdict = 'blocked' | 'blocks-all' | 'ok' | 'unknown';

export type AllowResult = 'done' | 'cancelled' | 'failed' | 'unsupported';

export type Run = (cmd: string, args: string[], opts?: { timeout?: number }) => Promise<string>;

const run: Run = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { windowsHide: true, encoding: 'utf8', timeout: opts?.timeout ?? 8000 },
      (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)),
    );
  });

const SOCKETFILTERFW = '/usr/libexec/ApplicationFirewall/socketfilterfw';
/** A person reading a password or UAC prompt is not a hung process. */
const PROMPT_MS = 180_000;

/** macOS: the application firewall's own answers, which need no administrator to read. */
export async function macVerdict(nodePath: string, exec: Run = run): Promise<FirewallVerdict> {
  const state = await exec(SOCKETFILTERFW, ['--getglobalstate']);
  if (/disabled|State = 0/i.test(state)) return 'ok';
  if (!/enabled|State = [12]/i.test(state)) return 'unknown';
  const all = await exec(SOCKETFILTERFW, ['--getblockall']);
  if (/block all state set to enabled|State = 2/i.test(all)) return 'blocks-all';
  const app = await exec(SOCKETFILTERFW, ['--getappblocked', nodePath]);
  if (/is blocked/i.test(app)) return 'blocked';
  if (/is permitted/i.test(app)) return 'ok';
  return 'unknown';
}

const ruleName = (port: number) => `Scenri-${port}`;
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Windows: which profile this Wi-Fi is on, whether the firewall is on for it,
 * which inbound rules name this node.exe, and whether Scenri's own port rule
 * is there. One line back, pipe separated, so the parse is the only thing a
 * test has to cover.
 */
export function windowsScript(nodePath: string, port: number): string {
  return [
    PS_UTF8,
    "$ErrorActionPreference='SilentlyContinue';",
    "$c=(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | Select-Object -First 1).NetworkCategory;",
    "$n=if ($c -eq 'DomainAuthenticated') { 'Domain' } else { \"$c\" };",
    '$on=(Get-NetFirewallProfile -Name $n).Enabled;',
    `$r=Get-NetFirewallApplicationFilter -Program ${psQuote(nodePath)} | Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' };`,
    "$b=@($r | Where-Object { $_.Action -eq 'Block' } | ForEach-Object { $_.Profile.ToString() }) -join ';';",
    "$a=@($r | Where-Object { $_.Action -eq 'Allow' } | ForEach-Object { $_.Profile.ToString() }) -join ';';",
    `$s=[bool](Get-NetFirewallRule -Name ${psQuote(ruleName(port))} | Where-Object { $_.Enabled -eq 'True' });`,
    'Write-Output "$n|$on|$b|$a|$s"',
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
  const [profile, on, block = '', allow = '', ours = ''] = line.split('|');
  if (!profile || !['Public', 'Private', 'Domain'].includes(profile)) return 'unknown';
  if (/^false$/i.test(on ?? '')) return 'ok';
  // a Block rule beats every Allow rule, Scenri's own included
  if (covers(block, profile)) return 'blocked';
  if (/^true$/i.test(ours) || covers(allow, profile)) return 'ok';
  // no rule for this network: Cancel was pressed, or only Private was ticked on a Public Wi-Fi
  return 'blocked';
}

/**
 * The elevated half: drop this node.exe's inbound Block rules, then allow
 * Scenri's port from the local subnet. Base64 UTF-16, as -EncodedCommand
 * takes it, so no path can break the quoting on the way through UAC.
 */
export function windowsAllowScript(nodePath: string, port: number): string {
  return [
    "$ErrorActionPreference='Stop';",
    'try {',
    `Get-NetFirewallApplicationFilter -Program ${psQuote(nodePath)} -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' } | Remove-NetFirewallRule;`,
    `Remove-NetFirewallRule -Name ${psQuote(ruleName(port))} -ErrorAction SilentlyContinue;`,
    `New-NetFirewallRule -Name ${psQuote(ruleName(port))} -DisplayName 'Scenri (phones on this network)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -RemoteAddress LocalSubnet -Profile Any | Out-Null;`,
    'exit 0',
    '} catch { exit 1 }',
  ].join(' ');
}

const encoded = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

/**
 * The unelevated launcher: asks UAC to run the script above and waits for it.
 * A declined prompt surfaces as Start-Process failing, whatever the language,
 * which is exit 1223 (ERROR_CANCELLED) here.
 */
export function windowsElevate(nodePath: string, port: number, env: NodeJS.ProcessEnv): string[] {
  const ps = powershellPath(env);
  const inner = `'-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand','${encoded(windowsAllowScript(nodePath, port))}'`;
  return [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `try { $p = Start-Process -FilePath ${psQuote(ps)} -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ${inner}; exit $p.ExitCode } catch { exit 1223 }`,
  ];
}

/** macOS: the password prompt comes from AppleScript; the path travels as an argument, never inside the script. */
export const macAllowArgs = (nodePath: string): string[] => [
  '-e',
  'on run argv',
  '-e',
  'set p to quoted form of item 1 of argv',
  '-e',
  `do shell script "${SOCKETFILTERFW} --add " & p & " && ${SOCKETFILTERFW} --unblockapp " & p with administrator privileges`,
  '-e',
  'end run',
  nodePath,
];

export async function allowScenri(opts: {
  port: number;
  platform?: NodeJS.Platform;
  nodePath?: string;
  env?: NodeJS.ProcessEnv;
  exec?: Run;
}): Promise<AllowResult> {
  const platform = opts.platform ?? process.platform;
  const nodePath = opts.nodePath ?? process.execPath;
  const exec = opts.exec ?? run;
  const env = opts.env ?? process.env;
  try {
    if (platform === 'darwin') {
      await exec('/usr/bin/osascript', macAllowArgs(nodePath), { timeout: PROMPT_MS });
      return 'done';
    }
    if (platform === 'win32') {
      await exec(powershellPath(env), windowsElevate(nodePath, opts.port, env), { timeout: PROMPT_MS });
      return 'done';
    }
    return 'unsupported';
  } catch (err) {
    const e = err as { code?: unknown; message?: string; stderr?: string };
    const said = `${e.message ?? ''} ${e.stderr ?? ''}`;
    // macOS: "User canceled. (-128)"; Windows: our own 1223 for a declined UAC
    if (e.code === 1223 || /\(-128\)|User cancel/i.test(said)) return 'cancelled';
    return 'failed';
  }
}

export async function firewallVerdict(opts: {
  port: number;
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
        windowsScript(nodePath, opts.port),
      ]);
      return parseWindows(out);
    }
  } catch {
    /* the probe itself failed: say nothing specific */
  }
  return 'unknown';
}
