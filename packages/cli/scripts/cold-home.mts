/**
 * The cold-start helper's one rule about homes: it only ever creates, uses or
 * deletes a directory inside this checkout's .scenri-cold, and never one that
 * is, holds, or sits inside the real library, or reaches anything through a
 * link. Kept apart from the helper so the rule can be tested without starting
 * anything.
 */
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

/** The file that marks a home this helper made; nothing without it is ever deleted. */
export const COLD_MARKER = '.scenri-cold-home';

const within = (child: string, parent: string) => child === parent || child.startsWith(parent + sep);

/** The nearest part of `p` that exists, resolved through any links. */
function realOfExisting(p: string): string {
  let at = resolve(p);
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  return realpathSync(at);
}

/**
 * Why `home` may not be used as a cold-start home, or null when it may.
 * `cold` is the checkout's .scenri-cold, `realHome` the real library
 * (~/.scenri); both are passed in so a test can point them anywhere.
 */
export function refuseHome(home: string, cold: string, realHome: string): string | null {
  const target = resolve(home);
  const root = resolve(cold);
  if (!within(target, root) || target === root) return `${target} is not inside ${root}`;
  // no link anywhere between .scenri-cold and the home, or at its content
  for (let at = target; within(at, root); at = dirname(at)) {
    if (existsSync(at) && lstatSync(at).isSymbolicLink()) return `${at} is a link`;
    if (at === root) break;
  }
  const content = join(target, 'content');
  if (existsSync(content) && lstatSync(content).isSymbolicLink()) return `${content} is a link`;
  const real = realOfExisting(target);
  const library = existsSync(realHome) ? realpathSync(realHome) : resolve(realHome);
  if (within(real, library) || within(library, real)) return `${target} reaches the real library at ${library}`;
  return null;
}

/** Make `home` empty and marked as ours, deleting only a home this helper made before. */
export function freshHome(home: string, cold: string, realHome: string): void {
  const why = refuseHome(home, cold, realHome);
  if (why) throw new Error(`refusing the cold-start home: ${why}`);
  if (existsSync(home)) {
    if (!existsSync(join(home, COLD_MARKER)))
      throw new Error(`${home} was not made by the cold-start helper; not deleting it`);
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, COLD_MARKER), 'Made by pnpm cold-start. Safe to delete.\n');
}
