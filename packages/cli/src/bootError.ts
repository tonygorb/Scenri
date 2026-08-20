/**
 * User-facing copy for boot failures. Node builtins only: index.ts prints
 * these strings, and the bin must stay loadable when a native module is the
 * thing that broke.
 */

export const INSTALL_GUIDE = 'https://github.com/tonygorb/scenri/blob/main/docs/INSTALL.md';

// The three shapes a broken better-sqlite3 or sharp install actually takes:
// ABI mismatch, dlopen failure, missing binding after a blocked install script.
const NATIVE_MARKERS = ['NODE_MODULE_VERSION', 'Could not locate the bindings file', 'ERR_DLOPEN_FAILED'];

export function portBusyLines(port: number): string[] {
  const next = port + 1;
  return [
    `Port ${port} is in use by another app.`,
    'Start Scenri on a different port:',
    `  macOS or Linux:      SCENRI_PORT=${next} npx scenri`,
    `  Windows PowerShell:  $env:SCENRI_PORT=${next}; npx scenri`,
  ];
}

export function bootErrorLines(err: unknown): string[] {
  const raw = err instanceof Error ? err.message : String(err);
  const first = raw.split('\n')[0];
  const code = (err as { code?: unknown } | null)?.code;
  const haystack = `${typeof code === 'string' ? code : ''} ${raw}`;
  if (NATIVE_MARKERS.some((marker) => haystack.includes(marker))) {
    return [
      'Scenri could not start: a native component failed to load.',
      `(${first})`,
      'This usually means Node changed since this copy of Scenri was installed.',
      'Fix: install the current Node LTS from https://nodejs.org, then run npx scenri@latest.',
    ];
  }
  return [
    `Scenri could not start: ${first}`,
    'If this keeps happening, run npx scenri@latest, or see the install guide:',
    INSTALL_GUIDE,
    'Set SCENRI_DEBUG=1 to see the full error.',
  ];
}
