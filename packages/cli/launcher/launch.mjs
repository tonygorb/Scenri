#!/usr/bin/env node
/**
 * Scenri desktop bootstrap, v1. A copy of this file lives in
 * ~/.scenri/launcher and is what the Desktop icon runs. It stays small and on
 * node builtins because copies of it live on Desktops indefinitely: it finds
 * the newest valid version under the recorded home and hands off to
 * `node <entry> open`, which holds every decision and is versioned with the
 * app. Change the hand-off and bump the schema in packages/cli/src/desktop;
 * the next start rewrites this copy.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 1;
const PKG = 'scenri';
const here = dirname(fileURLToPath(import.meta.url));

const record = readJson(join(here, 'launcher.json'));
const home = typeof record?.home === 'string' && record.home ? record.home : join(homedir(), '.scenri');
const logPath = join(home, 'logs', 'launcher.log');

log(`bootstrap v${SCHEMA}: invoked from ${here}`);
const version = newestVersion(home);
if (!version) {
  log(`bootstrap v${SCHEMA}: no valid version under ${join(home, 'app', 'versions')}`);
  dialog("Scenri's app files are missing. Open a terminal and run: npx scenri");
  process.exit(1);
}
const entry = join(home, 'app', 'versions', version, 'node_modules', PKG, 'dist', 'index.js');
const env = { ...process.env, ...(record?.env && typeof record.env === 'object' ? record.env : {}), SCENRI_HOME: home };
let fd = null;
try {
  mkdirSync(dirname(logPath), { recursive: true });
  fd = openSync(logPath, 'a');
} catch {
  /* no log: launch anyway */
}
const child = spawn(process.execPath, [entry, 'open'], {
  detached: true,
  stdio: ['ignore', fd ?? 'ignore', fd ?? 'ignore'],
  windowsHide: true,
  env,
});
child.unref();
if (fd !== null) closeSync(fd);
log(`bootstrap v${SCHEMA}: handing off to ${entry} (pid ${child.pid ?? 'unknown'})`);

// ---- helpers, duplicated from the package on purpose: this file stands alone

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function log(line) {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* a lost line, never a failed launch */
  }
}

/** The same rule as the updater's versionsDir: name matches, entry exists. */
function newestVersion(dataHome) {
  const versions = join(dataHome, 'app', 'versions');
  let names = [];
  try {
    names = readdirSync(versions);
  } catch {
    return null;
  }
  const valid = names.filter((v) => {
    const root = join(versions, v, 'node_modules', PKG);
    const manifest = readJson(join(root, 'package.json'));
    return manifest?.name === PKG && manifest.version === v && existsSync(join(root, 'dist', 'index.js'));
  });
  valid.sort(compareSemver);
  return valid[valid.length - 1] ?? null;
}

function compareSemver(a, b) {
  const pa = /^(\d+)\.(\d+)\.(\d+)$/.exec(a);
  const pb = /^(\d+)\.(\d+)\.(\d+)$/.exec(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** One native sentence when nothing else can speak; the message is an argument, never syntax. */
function dialog(message) {
  log(`dialog: ${message}`);
  if (process.env.SCENRI_NO_DIALOG === '1') return;
  try {
    if (process.platform === 'darwin') {
      spawnSync(
        '/usr/bin/osascript',
        ['-e', 'on run argv', '-e', 'display dialog (item 1 of argv) with title "Scenri" buttons {"OK"} default button 1 with icon stop', '-e', 'end run', '--', message],
        { stdio: 'ignore' },
      );
    } else if (process.platform === 'win32') {
      spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName System.Windows.Forms | Out-Null; [System.Windows.Forms.MessageBox]::Show($env:SCENRI_MESSAGE, 'Scenri') | Out-Null"],
        { stdio: 'ignore', windowsHide: true, env: { ...process.env, SCENRI_MESSAGE: message } },
      );
    }
  } catch {
    /* the log line above is the record */
  }
}
