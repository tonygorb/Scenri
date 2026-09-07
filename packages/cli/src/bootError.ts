/**
 * User-facing copy for boot failures. Node builtins only: index.ts prints
 * these strings, and the bin must stay loadable when a native module is the
 * thing that broke.
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

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

/**
 * A busy port answered as Scenri. Adopting it (open the browser there, exit 0)
 * is right when it is this library already running. A source checkout with a
 * different home would otherwise appear to start while serving another
 * checkout's library, so it refuses instead. Built installs keep adopting: one
 * Scenri per machine is their normal case, and an older server that reports no
 * home is treated as ours.
 */
export function shouldAdoptRunning(input: { installKind: string; ourHome: string; theirHome?: string }): boolean {
  if (input.installKind !== 'dev' || !input.theirHome) return true;
  return realDir(input.theirHome) === realDir(input.ourHome);
}

function realDir(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

export function anotherScenriLines(port: number, theirs: string, ours: string): string[] {
  return [
    `Port ${port} is held by another Scenri, serving ${theirs}.`,
    `This checkout would serve ${ours}, so it did not start.`,
    'Stop that server, or start this checkout on a different port:',
    `  SCENRI_PORT=${port + 1} pnpm dev`,
  ];
}
