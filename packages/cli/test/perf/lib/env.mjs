import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { ROOT } from './server.mjs';

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

/** What the numbers were measured on. Written into every result file. */
export function environmentRecord(extra = {}) {
  return {
    cpu: os.platform() === 'darwin' ? run('sysctl', ['-n', 'machdep.cpu.brand_string']) : os.cpus()[0]?.model,
    cores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    os: os.platform() === 'darwin' ? `macOS ${run('sw_vers', ['-productVersion'])}` : `${os.type()} ${os.release()}`,
    node: process.version,
    sha: run('git', ['rev-parse', '--short', 'HEAD']),
    branch: run('git', ['branch', '--show-current']),
    dirty: (run('git', ['status', '--porcelain']) ?? '').length > 0,
    loadAtStart: os.loadavg()[0],
    ...extra,
  };
}
