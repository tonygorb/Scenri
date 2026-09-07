/**
 * One native sentence when there is no terminal to print to. The message is
 * always data: an osascript argument, or an environment variable PowerShell
 * reads. SCENRI_NO_DIALOG=1 keeps harnesses quiet.
 *
 * On Windows the helper runs detached: DETACHED_PROCESS gives it no console
 * at all, so nothing flashes, and no SW_HIDE hint reaches it. That hint would
 * apply to the first window the process shows, which here is the box itself:
 * a hidden modal that nobody can see and nobody can dismiss.
 */
import { type SpawnOptions, spawn } from 'node:child_process';
import { powershellPath } from './paths.js';
import { POWERSHELL_ARGS } from './windows.js';

const MESSAGE_BOX =
  "Add-Type -AssemblyName System.Windows.Forms | Out-Null; [System.Windows.Forms.MessageBox]::Show($env:SCENRI_MESSAGE, 'Scenri') | Out-Null";

export interface DialogChild {
  once(event: 'error', listener: (err: Error) => void): unknown;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}
export type DialogSpawn = (cmd: string, args: string[], opts: SpawnOptions) => DialogChild;

export function showDialog(
  platform: NodeJS.Platform,
  message: string,
  env: NodeJS.ProcessEnv,
  spawnImpl: DialogSpawn = spawn,
): Promise<void> {
  if (env.SCENRI_NO_DIALOG === '1') return Promise.resolve();
  let cmd: string;
  let args: string[];
  let opts: SpawnOptions;
  if (platform === 'darwin') {
    cmd = '/usr/bin/osascript';
    args = [
      '-e',
      'on run argv',
      '-e',
      'display dialog (item 1 of argv) with title "Scenri" buttons {"OK"} default button 1 with icon stop',
      '-e',
      'end run',
      '--',
      message,
    ];
    opts = { stdio: 'ignore' };
  } else if (platform === 'win32') {
    cmd = powershellPath(env);
    args = [...POWERSHELL_ARGS, MESSAGE_BOX];
    opts = { stdio: 'ignore', detached: true, env: { ...env, SCENRI_MESSAGE: message } };
  } else {
    console.error(`\n  ${message}\n`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    try {
      const child = spawnImpl(cmd, args, opts);
      child.once('error', () => resolve());
      child.once('exit', () => resolve());
    } catch {
      resolve();
    }
  });
}
