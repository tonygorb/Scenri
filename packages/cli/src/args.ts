/**
 * Hand-rolled argv parsing. The surface is five commands and two flags; a
 * dependency would cost more than these forty lines. Configuration stays in
 * env vars (SCENRI_PORT etc.) — argv only selects what to run.
 */
export type Command =
  | { cmd: 'launch' }
  | { cmd: 'serve' }
  | { cmd: 'update'; check: boolean; from: string | undefined }
  | { cmd: 'verify' }
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

// `verify` is deliberately absent: it exists for the updater to probe a staged
// install, not for people.
export function helpText(): string {
  return `scenri: local brand studio

Usage
  scenri                start scenri (auto-restarts after updates)
  scenri serve          start this exact build, no supervision
  scenri update         download and stage the newest version
    --check             only check, do not download
  scenri --version      print the installed version
  scenri --help         this text

Configuration is via environment variables: SCENRI_PORT, SCENRI_HOST,
SCENRI_HOME, SCENRI_NO_OPEN, SCENRI_NO_UPDATE_CHECK, SCENRI_NO_CONTENT_FETCH,
SCENRI_CONTENT_URL.
`;
}
