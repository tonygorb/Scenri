/**
 * When What's New may open itself.
 *
 * A pure rule, sitting next to `updateRules.ts` for the same reason: the
 * question "is this a safe moment to take over the screen" is the whole
 * feature, and it deserves to be readable and testable without mounting the
 * app around it.
 *
 * Only a headline update ever asks (`lead`): a small one marks Help as unread
 * and waits on the What's New page. Every other clause is a way of saying the
 * same thing: the user is mid-something. A modal over mid-something is the
 * entire reason people learn to hate this pattern, and unlike an update notice
 * there is nothing here that cannot wait: the notes describe a version that is
 * already installed. If no safe moment ever comes, the unread mark on Help
 * carries it instead.
 */
export interface AutoOpenSignals {
  /** An unread headline update exists. Small updates never open anything. */
  lead: boolean;
  /** Auto-open has already had its one chance this session. */
  spent: boolean;
  /** The brand's workspace has answered; we are not still booting. */
  loaded: boolean;
  /** The tab is in front of the user. */
  visible: boolean;
  /** Settings, provider setup, a creation flow, Learn: anything with a URL of its own. */
  dialogOpen: boolean;
  /** Generations in flight. */
  running: number;
  /** Presenters and scenes being built. A finished build is history, not work. */
  builds: ReadonlyArray<{ finished: boolean }>;
  /**
   * Someone is still being introduced to Scenri: the first-use record has not
   * loaded, someone new has not answered the welcome, the guide has something
   * on screen, or the first shot is still in hand. One voice at a time, and
   * notes about a version mean nothing to someone learning it for the first time.
   */
  firstUse: boolean;
  /** The What's New page is on screen: it already says everything the dialog would. */
  onPage: boolean;
}

export function canAutoOpen(s: AutoOpenSignals): boolean {
  if (!s.lead || s.spent || s.firstUse || s.onPage) return false;
  if (!s.loaded || !s.visible || s.dialogOpen) return false;
  return s.running === 0 && !s.builds.some((b) => !b.finished);
}

/** "See 2 more updates", or "See all updates" when the one shown is the only news. */
export function moreLabel(more: number): string {
  return more > 0 ? `See ${more} more update${more === 1 ? '' : 's'}` : 'See all updates';
}
