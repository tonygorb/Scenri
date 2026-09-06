import type { DesktopStatus } from '../api.js';

/**
 * The Desktop shortcut row in Settings > About: one sentence and at most one
 * button, decided here so the component only maps kinds to markup. An earlier
 * "Not now" at the terminal never hides the button: that answer silenced the
 * prompt, not the offer.
 */
export type DesktopRow = { body: string; action: 'add' | 'recreate' | 'retry' | null };

export function desktopRow(s: DesktopStatus | null, error: string | null): DesktopRow {
  if (error) return { body: error, action: 'retry' };
  if (!s) return { body: 'Checking this machine.', action: null };
  if (s.installKind === 'dev') return { body: 'Running from source; nothing to put on a desktop.', action: null };
  if (!s.supported) return { body: 'Desktop shortcuts are not available on this system yet.', action: null };
  if (s.installed) return { body: 'Scenri is on your desktop.', action: 'recreate' };
  return { body: 'Open Scenri without a terminal.', action: 'add' };
}
