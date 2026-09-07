#!/usr/bin/env node
/**
 * The Windows desktop icon, clicked for real. Every unit test of the launcher
 * mocks PowerShell, so this is the one place the chain runs as a person meets
 * it: pack the source as 99.0.0, install it like a global npm install, put the
 * icon on a Desktop, double-click it (Invoke-Item is ShellExecute, the same
 * call Explorer makes), and read the launcher's own log for each link. Runs on
 * a windows-latest runner and by hand on a VM:
 *
 *   node packages/cli/test/manual-desktop-windows.mjs
 *
 * Preconditions: `pnpm build` done (studio dist exists), a working npm.
 * Anywhere but Windows it says so and exits 0. Work lands under RUNNER_TEMP
 * when set (the CI job uploads its logs) and is left in place on failure.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, npm, packFixture } from './pack-fixture.mjs';

if (process.platform !== 'win32') {
  console.log('the desktop click test is Windows-only; skipping, not failing');
  process.exit(0);
}
const ROOT = join(CLI, '..', '..');
if (!existsSync(join(ROOT, 'apps', 'studio', 'dist', 'index.html'))) {
  console.error('FAIL: run `pnpm build` first');
  process.exit(1);
}

const PORT = 4793;
const root = join(process.env.RUNNER_TEMP ?? tmpdir(), 'sc-desktop');
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const homeDir = join(root, 'home');
const dataDir = join(root, 'data');
const desktopDir = join(root, 'Desktop');
const prefix = join(root, 'prefix');
const scripts = join(root, 'ps');
for (const d of [homeDir, dataDir, desktopDir, prefix, scripts]) mkdirSync(d, { recursive: true });
const launcherLog = join(dataDir, 'logs', 'launcher.log');
const serverLog = join(dataDir, 'logs', 'scenri.log');
const support = join(homeDir, '.scenri', 'launcher');
const lnk = join(desktopDir, 'Scenri.lnk');

const env = {
  ...process.env,
  USERPROFILE: homeDir,
  HOME: homeDir,
  SCENRI_HOME: dataDir,
  SCENRI_DESKTOP_DIR: desktopDir,
  SCENRI_PORT: String(PORT),
  SCENRI_NO_UPDATE_CHECK: '1',
  SCENRI_NO_CONTENT_FETCH: '1',
  SCENRI_DEMO_ENGINE: '1',
};
// the point is to see the page, the browser and the dialogs
for (const k of ['SCENRI_NO_OPEN', 'SCENRI_NO_DIALOG', 'SCENRI_NO_DESKTOP']) delete env[k];

const ok = (msg) => console.log(`ok: ${msg}`);
const note = (msg) => console.log(`  ${msg}`);
const tail = (path, n = 40) =>
  existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).slice(-n).join('\n') : '(no file)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  console.error(`--- launcher.log (${launcherLog})\n${tail(launcherLog)}`);
  console.error(`--- scenri.log (${serverLog})\n${tail(serverLog)}`);
  console.error(`--- visible windows\n${visibleWindows().join('\n')}`);
  console.error(
    `--- our processes\n${ourProcesses()
      .map((p) => `${p.pid}\t${p.cmd}`)
      .join('\n')}`,
  );
  killOurs();
  process.exit(1);
}

// ---- PowerShell, by its absolute path, every command a file so no quoting crosses a boundary

const SYSTEM_ROOT = process.env.SystemRoot || 'C:\\Windows';
const PS = join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const PS_UTF8 = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ';

const script = (name, body) => {
  const file = join(scripts, `${name}.ps1`);
  writeFileSync(file, `${PS_UTF8}\n${body}\n`);
  return file;
};
const ps = (file, extraEnv = {}, opts = {}) =>
  spawnSync(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
    encoding: 'utf8',
    env: { ...env, ...extraEnv },
    windowsHide: true,
    timeout: 60_000,
    ...opts,
  });
const psLines = (file, extraEnv) => {
  const r = ps(file, extraEnv);
  if (r.status !== 0) fail(`${file} failed (${r.status}): ${r.stderr}`);
  return r.stdout.split(/\r?\n/).filter(Boolean);
};

const WIN32 = `
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  public static List<string> Visible() {
    var r = new List<string>();
    EnumWindows((h, l) => {
      if (IsWindowVisible(h)) { uint pid; GetWindowThreadProcessId(h, out pid); var sb = new StringBuilder(512); GetWindowText(h, sb, 512); if (sb.Length > 0) r.Add(pid + "\\t" + sb.ToString()); }
      return true; }, IntPtr.Zero);
    return r;
  }
  public static string Find(string title) {
    IntPtr h = FindWindow(null, title);
    if (h == IntPtr.Zero) return "absent";
    return IsWindowVisible(h) ? "visible" : "hidden";
  }
}
"@
`;
const windowsPs = script('windows', `${WIN32}\n[W]::Visible() | ForEach-Object { Write-Output $_ }`);
const findPs = script('find', `${WIN32}\nWrite-Output ([W]::Find($env:SC_TITLE))`);
const sessionPs = script('session', 'Write-Output (Get-Process -Id $pid).SessionId');
const procsPs = script(
  'procs',
  'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:SC_NEEDLE) } | ForEach-Object { Write-Output ("{0}`t{1}" -f $_.ProcessId, $_.CommandLine) }',
);
const readLnkPs = script(
  'readlnk',
  '$s = New-Object -ComObject WScript.Shell; $l = $s.CreateShortcut($env:SC_LNK); Write-Output $l.TargetPath; Write-Output $l.Arguments; Write-Output $l.WorkingDirectory; Write-Output $l.WindowStyle; Write-Output $l.IconLocation',
);
const clickPs = script('click', 'Invoke-Item -LiteralPath $env:SC_LNK');
const browsersPs = script(
  'browsers',
  'Get-Process -Name msedge,chrome,firefox,brave -ErrorAction SilentlyContinue | ForEach-Object { Write-Output $_.Name }',
);
const defaultsPs = script(
  'defaults',
  "foreach ($k in 'http') { $p = Get-ItemProperty -Path (\"HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\$k\\UserChoice\") -ErrorAction SilentlyContinue; Write-Output (\"$k=\" + $p.ProgId) }; $h = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.html\\UserChoice' -ErrorAction SilentlyContinue; Write-Output ('.html=' + $h.ProgId); Write-Output ('terminal=' + (Get-ItemProperty -Path 'HKCU:\\Console\\%%Startup' -ErrorAction SilentlyContinue).DelegationConsole)",
);

const visibleWindows = () => (ps(windowsPs).stdout ?? '').split(/\r?\n/).filter(Boolean);
const ourProcesses = () =>
  (ps(procsPs, { SC_NEEDLE: root }).stdout ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [pid, ...cmd] = l.split('\t');
      return { pid: Number(pid), cmd: cmd.join('\t') };
    })
    .filter((p) => p.pid !== process.pid);
const killOurs = () => {
  for (const p of ourProcesses()) spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
};
const findWindow = (title) => psLines(findPs, { SC_TITLE: title })[0] ?? 'absent';

// ---- 0. the machine

const session = Number(psLines(sessionPs)[0]);
note(`session ${session}${session === 0 ? ' (no interactive desktop: window checks are informational)' : ''}`);
const interactive = session !== 0;
for (const l of psLines(defaultsPs)) note(`default ${l}`);
note(`node ${process.version} at ${process.execPath}`);

// ---- 1. pack and install, global shape

const { tarball } = packFixture('99.0.0', { root, prefix: 'pack-' });
ok(`packed ${tarball}`);
npm(['install', '-g', '--prefix', prefix, '--loglevel=error', tarball], { stdio: 'inherit', env });
const entry = join(prefix, 'node_modules', 'scenri', 'dist', 'index.js');
if (!existsSync(entry)) fail(`no entry at ${entry}`);
ok(`installed at ${entry}`);

const runScenri = (args, extraEnv = {}) =>
  spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env: { ...env, ...extraEnv }, timeout: 300_000 });

// ---- 2. a Desktop with a non-ASCII path: install twice (the second reads the .lnk back), then remove

const umlaut = join(root, 'Bürö');
mkdirSync(umlaut, { recursive: true });
for (const pass of [1, 2]) {
  const r = runScenri(['desktop'], { SCENRI_DESKTOP_DIR: umlaut });
  if (r.status !== 0 || !/Added Scenri to your desktop/.test(r.stdout)) {
    fail(`desktop (pass ${pass}, umlaut) exited ${r.status}:\n${r.stdout}\n${r.stderr}`);
  }
  if (/Something else named Scenri/.test(r.stdout)) fail('the read-back of our own .lnk came back mangled');
}
ok('an umlaut Desktop reads its own .lnk back (UTF-8 through a redirected stdout)');
{
  const r = runScenri(['desktop', '--remove'], { SCENRI_DESKTOP_DIR: umlaut });
  if (r.status !== 0 || existsSync(join(umlaut, 'Scenri.lnk')) || existsSync(support)) {
    fail(`desktop --remove (umlaut) left things behind (${r.status}):\n${r.stdout}`);
  }
}

// ---- 3. the real install

{
  const r = runScenri(['desktop']);
  if (r.status !== 0 || !/Added Scenri to your desktop/.test(r.stdout)) {
    fail(`desktop exited ${r.status}:\n${r.stdout}\n${r.stderr}`);
  }
}
if (!existsSync(lnk)) fail(`no ${lnk}`);
const record = JSON.parse(readFileSync(join(support, 'launcher.json'), 'utf8'));
if (record.artifact?.kind !== 'windows-lnk' || record.artifact.path !== lnk) fail(`record: ${JSON.stringify(record)}`);
if (record.nodeMajor !== Number(process.versions.node.split('.')[0])) fail(`nodeMajor ${record.nodeMajor}`);
if (!existsSync(record.nodePath)) fail(`recorded node missing: ${record.nodePath}`);
const managed = join(dataDir, 'app', 'versions', '99.0.0', 'node_modules', 'scenri', 'dist', 'index.js');
if (!existsSync(managed)) fail(`no managed copy at ${managed}`);
ok(`installed the icon: ${lnk}, node ${record.nodePath}, copy ${managed}`);

const [target, args, workdir, windowStyle, icon] = psLines(readLnkPs, { SC_LNK: lnk });
if (target !== record.nodePath) fail(`.lnk target ${target} is not the recorded node ${record.nodePath}`);
if (args !== `"${join(support, 'launch.mjs')}"`) fail(`.lnk arguments ${args}`);
if (workdir !== support) fail(`.lnk working directory ${workdir}`);
if (windowStyle !== '7') fail(`.lnk window style ${windowStyle}`);
if (!/scenri\.ico,0$/.test(icon)) fail(`.lnk icon ${icon}`);
ok('the .lnk points at node with the bootstrap as its one argument, minimised, with the real icon');

// ---- 4. the two helpers, probed in every spawn mode before the click depends on them

const messageBox =
  "Add-Type -AssemblyName System.Windows.Forms | Out-Null; [System.Windows.Forms.MessageBox]::Show($env:SCENRI_MESSAGE, 'Scenri') | Out-Null";
// The shipped mode first; the detached one stays as the record of why it is not
// shipped (windows-latest, 2026-09-07: windowsHide visible, detached absent).
const dialogModes = {
  'windowsHide (shipped)': { stdio: 'ignore', windowsHide: true },
  'detached (rejected)': { stdio: 'ignore', detached: true },
};
for (const [name, opts] of Object.entries(dialogModes)) {
  const child = spawn(PS, ['-NoProfile', '-NonInteractive', '-Command', messageBox], {
    ...opts,
    env: { ...env, SCENRI_MESSAGE: `probe ${name}` },
  });
  let seen = 'absent';
  for (let i = 0; i < 40 && seen === 'absent'; i++) {
    await sleep(250);
    seen = findWindow('Scenri');
  }
  note(`dialog probe, ${name}: ${seen}`);
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  if (interactive && name.includes('shipped') && seen !== 'visible') fail(`the shipped dialog mode is ${seen}`);
}

const hits = [];
const probeServer = createServer((req, res) => {
  hits.push({ url: req.url, ua: req.headers['user-agent'] ?? '' });
  res.setHeader('content-type', 'text/html');
  res.end('<title>probe</title>ok');
});
await new Promise((r) => probeServer.listen(0, '127.0.0.1', r));
const probeUrl = `http://127.0.0.1:${probeServer.address().port}/`;
const openers = [
  ['powershell Start-Process', PS, ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process $env:SCENRI_URL']],
  ['rundll32 FileProtocolHandler', join(SYSTEM_ROOT, 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler']],
  ['explorer', join(SYSTEM_ROOT, 'explorer.exe'), []],
];
let anyBrowser = false;
for (const [name, cmd, base] of openers) {
  const url = `${probeUrl}?via=${encodeURIComponent(name)}`;
  const before = hits.length;
  const r = spawnSync(cmd, base.length && base[0] === '-NoProfile' ? base : [...base, url], {
    encoding: 'utf8',
    env: { ...env, SCENRI_URL: url },
    windowsHide: true,
    timeout: 15_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let got = null;
  for (let i = 0; i < 40 && !got; i++) {
    await sleep(250);
    got = hits.slice(before).find((h) => h.url.includes(encodeURIComponent(name)));
  }
  note(
    `opener probe, ${name}: exit ${r.status}${r.stderr?.trim() ? ` (${r.stderr.trim().split(/\r?\n/)[0]})` : ''}, ${got ? `fetched by ${got.ua}` : 'nothing fetched in 10 s'}`,
  );
  if (got) anyBrowser = true;
}
probeServer.close();
note(`browsers running: ${psLines(browsersPs).join(', ') || 'none'}`);
if (!anyBrowser)
  note('no opener reached a browser on this machine: the page and browser links below are informational');

// ---- 5. click

const logText = () => (existsSync(launcherLog) ? readFileSync(launcherLog, 'utf8') : '');
const count = (re) => (logText().match(re) ?? []).length;
const api = async (path, init) => {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { signal: AbortSignal.timeout(2000), ...init });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const upNow = () =>
  api('/api/version').then(
    (r) => (r.status === 200 ? r.body : null),
    () => null,
  );
async function waitFor(what, predicate, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await predicate();
    if (v) return v;
    await sleep(250);
  }
  fail(`timed out waiting for ${what}`);
}

async function click(n) {
  const r = ps(clickPs, { SC_LNK: lnk });
  if (r.status !== 0) fail(`Invoke-Item (click ${n}) failed: ${r.stderr}`);
  ok(`click ${n}: Invoke-Item returned ${r.status}`);
}

// L1 to L5: cold
if (await upNow()) fail(`something already answers on ${PORT}`);
await click(1);
await waitFor('the bootstrap line', () => /bootstrap v1: invoked from .* by .*node.* \(node v/.test(logText()), 15_000);
await waitFor('the hand-off line', () => /bootstrap v1: handing off to/.test(logText()), 15_000);
if (/no valid version|bootstrap v1: dialog:/.test(logText())) fail('the bootstrap found nothing to run');
await waitFor('open to start', () => /open: invoked by 99\.0\.0 \(/.test(logText()), 15_000);
await waitFor('the supervisor', () => /open: started the supervisor, pid \d+/.test(logText()), 15_000);
const booted = await waitFor('the server', upNow, 120_000);
if (booted.version !== '99.0.0' || !booted.supervised || booted.installKind !== 'managed') {
  fail(`booted the wrong thing: ${JSON.stringify(booted)}`);
}
ok(`click 1 booted ${booted.version} from app/versions, supervised (${booted.installKind})`);
await waitFor('the ready line', () => /open: ready in \d+ms/.test(logText()), 15_000);
if (!/open: serving the starting page at http:\/\/127\.0\.0\.1:\d+\//.test(logText()))
  fail('no starting page was served');
const fetched = await waitFor(
  'the browser verdict',
  () => logText().match(/open: the browser (fetched the starting page \(.*\)|never fetched the starting page.*)/)?.[0],
  25_000,
);
note(fetched);
if (anyBrowser && !/fetched the starting page \(/.test(fetched))
  fail('a browser exists here, yet none fetched the page');
if (/could not be opened|dialog:/.test(logText())) fail('the launcher log shows a dialog or a failed browser');
if (/Error| {4}at /.test(tail(serverLog, 200).split('Scenri Studio')[0] ?? ''))
  fail('scenri.log shows an error before the studio line');
ok(`the studio was handed to the browser (${fetched.replace(/^open: /, '')})`);

// L8: no window of ours is visible once the .lnk's own node has left
await waitFor(
  'the bootstrap process to exit',
  async () => !ourProcesses().some((p) => p.cmd.includes('launch.mjs')),
  15_000,
);
{
  const pids = new Set(ourProcesses().map((p) => p.pid));
  const windows = visibleWindows().filter((w) => pids.has(Number(w.split('\t')[0])));
  if (interactive && windows.length) fail(`visible windows belong to our processes:\n${windows.join('\n')}`);
  if (visibleWindows().some((w) => /\tScenri$/.test(w))) fail('a Scenri dialog is showing');
  ok(`no console or dialog is visible for ${pids.size} processes of ours`);
}

// L9: a second click joins
const supervisorsBefore = count(/started the supervisor/g);
await click(2);
await waitFor(
  'the join line',
  () => /open: Scenri 99\.0\.0 already running, opening the browser/.test(logText()),
  15_000,
);
await sleep(1000);
if (count(/started the supervisor/g) !== supervisorsBefore) fail('the second click started another server');
ok('click 2 joined the running server');

// L10: shut down from the app
async function quit() {
  const r = await api('/api/system/quit', { method: 'POST' });
  if (r.status !== 200) fail(`quit refused: ${r.status}`);
  await waitFor('the server to stop', async () => !(await upNow()), 20_000);
  await waitFor('our processes to leave', async () => ourProcesses().length === 0, 20_000);
}
await quit();
ok('Shut down stopped the server and the supervisor');

// L11: cold again
await click(3);
const again = await waitFor('the server again', upNow, 120_000);
if (again.version !== '99.0.0') fail(`third click booted ${again.version}`);
ok('click 3 booted it again');
await quit();

// L12: remove
{
  const r = runScenri(['desktop', '--remove']);
  if (r.status !== 0 || existsSync(lnk) || existsSync(support))
    fail(`desktop --remove left things behind:\n${r.stdout}`);
}
ok('desktop --remove took the icon and its support files away');

killOurs();
console.log(`\nlogs kept under ${dataDir}\\logs`);
ok('the Windows desktop icon works end to end');
