/**
 * The Windows launcher: a real Scenri.lnk on the Desktop, made through the
 * shell's own COM object from Windows PowerShell 5.1, which every supported
 * Windows has. The two commands below are constants; every value travels in
 * the environment ($env:SCENRI_*), so no path, user name or version is ever
 * PowerShell syntax. Inline -Command is not gated by the script execution
 * policy, and nothing is encoded, downloaded or written to the registry.
 */
import type { RunImpl } from './paths.js';

export const POWERSHELL = 'powershell.exe';
export const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-Command'];

/** WindowStyle 7 is "run minimised": the console the .lnk opens never lands on screen. */
export const CREATE_LNK_COMMAND =
  '$s = New-Object -ComObject WScript.Shell; $l = $s.CreateShortcut($env:SCENRI_LNK); ' +
  '$l.TargetPath = $env:SCENRI_TARGET; $l.Arguments = $env:SCENRI_ARGS; $l.WorkingDirectory = $env:SCENRI_WORKDIR; ' +
  "$l.IconLocation = $env:SCENRI_ICON; $l.Description = 'Open Scenri'; $l.WindowStyle = 7; $l.Save()";

/** CreateShortcut on an existing .lnk loads it, which is how we ask what it points at. */
export const READ_LNK_COMMAND =
  '$s = New-Object -ComObject WScript.Shell; $l = $s.CreateShortcut($env:SCENRI_LNK); ' +
  'Write-Output $l.TargetPath; Write-Output $l.Arguments';

export async function readLnk(runImpl: RunImpl, path: string): Promise<{ target: string; args: string }> {
  const out = await runImpl(POWERSHELL, [...POWERSHELL_ARGS, READ_LNK_COMMAND], { env: { SCENRI_LNK: path } });
  const [target = '', args = ''] = out.split(/\r?\n/);
  return { target: target.trim(), args: args.trim() };
}

/** Ours: it runs our bootstrap, whichever node it names. */
export async function isOurLnk(runImpl: RunImpl, path: string, bootstrap: string): Promise<boolean> {
  try {
    const { args } = await readLnk(runImpl, path);
    return args.toLowerCase().includes(bootstrap.toLowerCase());
  } catch {
    return false;
  }
}

export async function writeLnk(
  runImpl: RunImpl,
  opts: { path: string; target: string; args: string; workdir: string; icon: string },
): Promise<void> {
  await runImpl(POWERSHELL, [...POWERSHELL_ARGS, CREATE_LNK_COMMAND], {
    env: {
      SCENRI_LNK: opts.path,
      SCENRI_TARGET: opts.target,
      SCENRI_ARGS: opts.args,
      SCENRI_WORKDIR: opts.workdir,
      SCENRI_ICON: opts.icon,
    },
  });
}
