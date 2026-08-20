import type { EngineInfo } from '../api.js';

/**
 * The two questions the UI asks about engines that are not about identity:
 * what to call one, and which one is about to run.
 *
 * Both were answered in more than one place. The `(BYOK)` strip existed three
 * times and the composer's own picker was the copy that did not run, so it
 * showed "OpenRouter (BYOK)" while settings showed "OpenRouter". The
 * auto-correction below lived only inside the composer, which meant settings
 * could not say which engine would actually be used.
 */

/**
 * A provider's name as a person says it. "BYOK" is our word for our billing
 * arrangement, and it is noise in a list whose entire subject is your own keys.
 */
export const engineTitle = (displayName: string): string => displayName.replace(/\s*\(BYOK\)\s*$/i, '');

/** Codex, because it is the path the product leads with and the one that needs no key. */
export const FALLBACK_ENGINE_ID = 'codex-cli';

/**
 * Which engine will run the next brief, given what the user picked and what is
 * actually connected now.
 *
 * A stored choice can go stale: the key behind it was replaced, or the machine
 * changed. Rather than fail at send time, the pick falls back to the first
 * usable engine, and to Codex when nothing is usable at all, which is also what
 * a first run sees.
 */
export function effectiveEngineId(usable: Pick<EngineInfo, 'id'>[], stored: string): string {
  if (usable.some((e) => e.id === stored)) return stored;
  return usable[0]?.id ?? FALLBACK_ENGINE_ID;
}

/**
 * A per-image estimate, trimmed of trailing zeroes: 0.04 and 0.003 both read as
 * themselves rather than as $0.040 and $0.003000.
 */
export const perImage = (usd: number): string => usd.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');

/**
 * The one line under a provider's name. Never the word "free": Codex costs
 * nothing through Scenri, which is a different sentence from costing nothing,
 * because every image spends the allowance on a ChatGPT plan the person pays
 * for themselves.
 */
export function engineMeta(e: Pick<EngineInfo, 'free' | 'localOnly' | 'perGeneration'>): string {
  if (!e.free) return `$${perImage(e.perGeneration)} / image`;
  return e.localOnly ? 'Runs on your ChatGPT plan' : 'No cost per image';
}
