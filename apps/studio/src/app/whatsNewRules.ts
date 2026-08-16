/**
 * When What's New may open itself.
 *
 * A pure rule, sitting next to `updateRules.ts` for the same reason: the
 * question "is this a safe moment to take over the screen" is the whole
 * feature, and it deserves to be readable and testable without mounting the
 * app around it.
 *
 * Every clause is a way of saying the same thing — the user is mid-something.
 * A modal over mid-something is the entire reason people learn to hate this
 * pattern, and unlike an update notice there is nothing here that cannot wait:
 * the notes describe a version that is already installed. If no safe moment
 * ever comes, the unread dot in the brand menu carries it instead.
 */
export interface AutoOpenSignals {
  /** These notes have not been acknowledged on this machine. */
  unread: boolean;
  /** Auto-open has already had its one chance this session. */
  spent: boolean;
  /** The brand's workspace has answered; we are not still booting. */
  loaded: boolean;
  /** The tab is in front of the user. */
  visible: boolean;
  /** Settings, provider setup, a creation flow — anything with a URL of its own. */
  dialogOpen: boolean;
  /** Generations in flight. */
  running: number;
  /** Presenters and scenes being built. */
  builds: number;
}

export function canAutoOpen(s: AutoOpenSignals): boolean {
  if (!s.unread || s.spent) return false;
  if (!s.loaded || !s.visible || s.dialogOpen) return false;
  return s.running === 0 && s.builds === 0;
}
