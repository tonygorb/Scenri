/**
 * The current source, assembled and packed as a fixture version: the one
 * real artifact both live tests start from (the update loop, the Windows
 * desktop click). Everything spawns node with a JS entry, never npm.cmd or
 * pnpm.cmd, so it runs the same on a Windows runner as on a Mac.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI = join(dirname(fileURLToPath(import.meta.url)), '..');

/** npm's own JS entry, wherever this node keeps it; null when only PATH knows. */
export function npmCli() {
  const bin = dirname(process.execPath);
  for (const c of [
    join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]) {
    if (existsSync(c)) return c;
  }
  const fromEnv = process.env.npm_execpath?.replace(/npx-cli\.js$/, 'npm-cli.js');
  return fromEnv && /npm-cli\.js$/.test(fromEnv) && existsSync(fromEnv) ? fromEnv : null;
}

/** Runs npm with an argv, through this node when its entry is known, else bare npm on PATH (POSIX). */
export function npm(args, opts = {}) {
  const cli = npmCli();
  return cli ? execFileSync(process.execPath, [cli, ...args], opts) : execFileSync('npm', args, opts);
}

/**
 * Assemble the current source (prepack: tsup, studio bundle, catalog, legal
 * files) and pack it as `version`. Returns the work dir, the package dir, the
 * tarball path and the manifest as packed.
 */
export function packFixture(version, opts = {}) {
  execFileSync(process.execPath, [join(CLI, 'scripts', 'prepack.mjs')], { cwd: CLI, stdio: 'ignore' });
  const work = mkdtempSync(join(opts.root ?? tmpdir(), opts.prefix ?? 'sc-pack-'));
  const pkgDir = join(work, 'pkg');
  mkdirSync(pkgDir);
  for (const part of ['dist', 'studio-dist', 'templates', 'launcher', 'LICENSE', 'NOTICE', 'README.md']) {
    cpSync(join(CLI, part), join(pkgDir, part), { recursive: true });
  }
  const manifest = JSON.parse(readFileSync(join(CLI, 'package.json'), 'utf8'));
  manifest.version = version;
  manifest.scripts = {}; // no prepack in the copy: it is already assembled
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(manifest, null, 2));
  const tarball = join(pkgDir, npm(['pack', '--loglevel=error'], { cwd: pkgDir }).toString().trim());
  return { work, pkgDir, tarball, manifest };
}
