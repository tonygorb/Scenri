/**
 * The environment one codex child sees.
 *
 * Scenri never changes the machine it runs on. When a stale credential in the
 * environment is what stops Codex working, the fix is to launch codex without
 * that variable, for that child only: the user's shell, their profile and
 * their system settings stay exactly as they were.
 *
 * A full copy minus named keys, never a hand-picked allowlist. The child needs
 * PATH, HOME or USERPROFILE, CODEX_HOME, APPDATA, SystemRoot and, on the shell
 * branch, ComSpec; a curated list of "what codex needs" is a list that goes
 * stale on the next Node or Windows release and fails in a way nobody can
 * read.
 */

/**
 * Windows environment names are case-insensitive, so an exact-match drop would
 * sail straight past a machine carrying `Codex_Api_Key`. Matching that way on
 * every platform costs nothing and removes a whole class of "it works on my
 * Mac".
 */
export function buildChildEnv(parent: NodeJS.ProcessEnv, drop: readonly string[]): NodeJS.ProcessEnv {
  if (drop.length === 0) return { ...parent };
  const unwanted = new Set(drop.map((name) => name.toUpperCase()));
  const child: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(parent)) {
    if (unwanted.has(name.toUpperCase())) continue;
    child[name] = value;
  }
  return child;
}
