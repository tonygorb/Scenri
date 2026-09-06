/**
 * The launcher's diagnostics. Nothing here may throw: a log line that cannot
 * be written is a lost line, never a failed launch. Two files, both under
 * <home>/logs: `launcher.log` for the bootstrap and `scenri open`, `scenri.log`
 * for the stdout and stderr of a server that has no terminal to print to.
 */
import { appendFileSync, mkdirSync, openSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_MAX = 1024 * 1024;

/** Keep one previous generation; a launcher that rotates twice a year is plenty. */
function rotate(path: string, maxBytes: number): void {
  try {
    if (statSync(path).size > maxBytes) renameSync(path, `${path}.1`);
  } catch {
    /* no file yet, or unreadable: appending will tell */
  }
}

export function appendLog(path: string, line: string, opts: { maxBytes?: number } = {}): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    rotate(path, opts.maxBytes ?? DEFAULT_MAX);
    appendFileSync(path, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* lost line */
  }
}

/** An append descriptor a child process can inherit for stdout and stderr. */
export function openLogFd(path: string, opts: { maxBytes?: number } = {}): number {
  mkdirSync(dirname(path), { recursive: true });
  rotate(path, opts.maxBytes ?? 5 * DEFAULT_MAX);
  return openSync(path, 'a');
}
