/**
 * The launch-dispatch predicate: does this process run from a built dist/
 * entry? Decided from the module's own realpathed location, never from
 * process.argv[1]. On macOS and Linux npm links bins as symlinks
 * (node_modules/.bin/scenri -> ../scenri/dist/index.js) and Node keeps the
 * symlink path in argv, so the argv path never contains the dist/ segment
 * that marks a published build — which is how every published POSIX install
 * silently skipped the supervising launcher. The ESM loader does realpath
 * import.meta.url, the same source of truth detectInstallKind relies on.
 */
export function isBuiltEntry(entryPath: string): boolean {
  return /[\\/]dist[\\/]/.test(entryPath);
}
