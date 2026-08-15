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
