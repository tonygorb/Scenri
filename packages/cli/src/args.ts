/**
 * Hand-rolled argv parsing. The surface is seven commands and three flags; a
 * dependency would cost more than these fifty lines. Configuration stays in
 * env vars (SCENRI_PORT etc.) — argv only selects what to run.
 */
export type Command =
  | { cmd: 'launch' }
  | { cmd: 'serve' }
  | { cmd: 'update'; check: boolean; from: string | undefined }
  | { cmd: 'verify' }
  | { cmd: 'desktop'; remove: boolean }
  | { cmd: 'open' }
  | { cmd: 'version' }
  | { cmd: 'help' }
  | { cmd: 'error'; message: string };

export function parseArgs(argv: string[]): Command {
  const [first, ...rest] = argv;
  if (first === undefined) return { cmd: 'launch' };
  if (first === '--version' || first === '-v') return { cmd: 'version' };
  if (first === '--help' || first === '-h') return { cmd: 'help' };
  if (first === 'serve') return { cmd: 'serve' };
  if (first === 'verify') return { cmd: 'verify' };
  if (first === 'open') return { cmd: 'open' };
  if (first === 'desktop') {
    let remove = false;
    for (const a of rest) {
      if (a === '--remove') remove = true;
      else return { cmd: 'error', message: `unknown option '${a}' (try --help)` };
    }
    return { cmd: 'desktop', remove };
  }
  if (first === 'update') {
    let check = false;
    let from: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--check') check = true;
      else if (a === '--from') {
        from = rest[++i];
        if (from === undefined) return { cmd: 'error', message: '--from requires a value' };
      } else return { cmd: 'error', message: `unknown option '${a}' (try --help)` };
    }
    return { cmd: 'update', check, from };
  }
  return { cmd: 'error', message: `unknown command '${first}' (try --help)` };
}

// `verify` and `open` are deliberately absent: one exists for the updater to
// probe a staged install, the other for the desktop icon's bootstrap to call.
export function helpText(): string {
  return `Scenri: local brand studio

Usage
  scenri                start Scenri (auto-restarts after updates)
  scenri serve          start this exact build, no supervision
  scenri update         download and stage the newest version
    --check             only check, do not download
  scenri desktop        add Scenri to your desktop (or repair the icon)
    --remove            take it off again
  scenri --version      print the installed version
  scenri --help         this text

Configuration is via environment variables: SCENRI_PORT, SCENRI_HOST,
SCENRI_HOME, SCENRI_NO_OPEN, SCENRI_NO_UPDATE_CHECK, SCENRI_NO_CONTENT_FETCH,
SCENRI_CONTENT_URL, SCENRI_NO_DESKTOP.
`;
}
