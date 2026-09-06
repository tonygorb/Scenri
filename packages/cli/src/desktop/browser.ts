/**
 * The default browser, from a process that may have no console. macOS and
 * Linux go through the `open` package like serve does. Windows does not: the
 * package runs an unhidden PowerShell, which flashes a window from a hidden
 * parent, so the same Start-Process call is made here with the window hidden
 * and the URL in the environment rather than in an encoded command.
 */
import { spawn } from 'node:child_process';
import { POWERSHELL, POWERSHELL_ARGS } from './windows.js';

export async function openInBrowser(url: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<void> {
  if (platform === 'win32') {
    await new Promise<void>((resolve) => {
      const child = spawn(POWERSHELL, [...POWERSHELL_ARGS, 'Start-Process $env:SCENRI_URL'], {
        stdio: 'ignore',
        windowsHide: true,
        detached: true,
        env: { ...env, SCENRI_URL: url },
      });
      child.once('error', () => resolve());
      child.once('spawn', () => resolve());
      child.unref();
    });
    return;
  }
  const { default: open } = await import('open');
  await open(url);
}
