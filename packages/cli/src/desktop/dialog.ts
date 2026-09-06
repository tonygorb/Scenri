/**
 * One native sentence when there is no terminal to print to. The message is
 * always data: an osascript argument, or an environment variable PowerShell
 * reads. SCENRI_NO_DIALOG=1 keeps harnesses quiet.
 */
import { spawn } from 'node:child_process';
import { POWERSHELL, POWERSHELL_ARGS } from './windows.js';

const MESSAGE_BOX =
  "Add-Type -AssemblyName System.Windows.Forms | Out-Null; [System.Windows.Forms.MessageBox]::Show($env:SCENRI_MESSAGE, 'Scenri') | Out-Null";

export function showDialog(platform: NodeJS.Platform, message: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (env.SCENRI_NO_DIALOG === '1') return Promise.resolve();
  let cmd: string;
  let args: string[];
  let childEnv: NodeJS.ProcessEnv | undefined;
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
  } else if (platform === 'win32') {
    cmd = POWERSHELL;
    args = [...POWERSHELL_ARGS, MESSAGE_BOX];
    childEnv = { ...env, SCENRI_MESSAGE: message };
  } else {
    console.error(`\n  ${message}\n`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true, env: childEnv });
      child.once('error', () => resolve());
      child.once('exit', () => resolve());
    } catch {
      resolve();
    }
  });
}
