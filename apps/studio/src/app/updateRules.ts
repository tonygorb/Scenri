import type { UpdateStatus } from '../api.js';

/**
 * Whether the Update button may do the work itself.
 *
 * Before anything is staged that means the full chain: supervised, a launcher
 * that speaks the protocol, npm reachable (`canApply`). Once a version is
 * staged and verified (`phase: 'ready'`), the download is behind us — only a
 * supervisor is still required, so a missing npm no longer blocks the finish.
 */
export function canOneClick(s: UpdateStatus | null): boolean {
  if (!s) return false;
  if (s.phase === 'ready') {
    return s.blockReason !== 'dev' && s.blockReason !== 'unsupervised' && s.blockReason !== 'launcher-too-old';
  }
  return s.canApply;
}

/**
 * What the floating notice is saying right now. Staging usually starts on the
 * server without a click, so the float has to narrate the whole arc: announce,
 * downloading, ready, or a download that failed. Pure so the matrix is
 * testable; the component only maps kinds to copy.
 */
export type FloatState =
  | { kind: 'announce'; oneClick: boolean }
  | { kind: 'downloading' }
  | { kind: 'ready'; version: string }
  | { kind: 'stage-error' };

/**
 * Whether the float has any business appearing. A source checkout never
 * self-updates and never shows an update action (the dev safety contract), so
 * a float there could only open About onto a pane with nothing to press — a
 * dead loop dressed as a button. Every other blocked install keeps its float:
 * About offers those the manual command, which is a real next step.
 */
export function floatVisible(s: UpdateStatus | null): boolean {
  return !!s?.available && s.blockReason !== 'dev';
}

export function floatState(s: UpdateStatus): FloatState {
  if (s.phase === 'staging') return { kind: 'downloading' };
  if (s.phase === 'ready') return { kind: 'ready', version: s.stagedVersion ?? s.latest ?? s.current };
  if (s.phase === 'error' && s.available) return { kind: 'stage-error' };
  return { kind: 'announce', oneClick: canOneClick(s) };
}
