import { useCallback } from 'react';
import { SETTINGS_INDEX } from '../views/settingsPages.js';
import { useDialogParam } from './AppShell.js';

/**
 * The two dialogs any surface may ask for, and the one place that knows how to
 * ask.
 *
 * These hooks used to live inside the dialogs they open, which made
 * SettingsDialog and the provider setup dialog import each other in a cycle:
 * settings needed to drill into setup, and setup needed to hand people back to
 * settings. Both are URLs, so neither hook needs its dialog at all, and two
 * open dialogs are two params rather than a handoff.
 */

/**
 * Every dialog that lives in the address. Anything that must wait while one is
 * open (the tutor, What's New opening by itself) reads this one list, so a new
 * dialog param is added once and every waiter respects it.
 */
export const ADDRESS_DIALOGS = ['settings', 'setup', 'new', 'whatsnew', 'learn', 'welcome'] as const;

/**
 * Where Settings opens. Every id names one page (views/settingsPages.ts),
 * and the older ids stay, so every link and remedy that ever named one still
 * lands: `general` on Appearance, `budget` on Providers.
 */
export type Pane =
  | 'brand'
  | 'engines'
  | 'budget'
  | 'usage'
  | 'general'
  | 'library'
  | 'appearance'
  | 'phone'
  | 'updates'
  | 'about'
  | 'danger';

/**
 * Settings, at a pane, or without one: then a phone starts on the index and a
 * desktop on the first page. A URL, so it survives a refresh and answers to Back.
 */
export function useOpenSettings() {
  const { open } = useDialogParam('settings');
  return useCallback((pane?: Pane) => open(pane ?? SETTINGS_INDEX), [open]);
}

/** Codex, because the setup dialog opened without an engine is the Codex one. */
/** The welcome again, from Help: it lives in the address so it opens over any page. */
export function useOpenWelcome() {
  const { open } = useDialogParam('welcome');
  return useCallback(() => open('1'), [open]);
}

/**
 * Who last asked to open Learn, for the one thing a URL param cannot carry:
 * the control to give the keyboard back to when it closes with nothing begun.
 * Radix's own restore has nothing to work from here — the bar's Learn button
 * survives, but Help's own menu item is gone the moment its menu closes, so
 * by the time Learn's dialog mounts there is no live trigger left for Radix
 * to have noticed either way (measured: both paths land on `body`, not on
 * whichever button was really clicked). Set at the one call each opener
 * makes, read once by LearnDialog when it opens, and cleared right after so
 * a later plain click never inherits a stale answer.
 */
export const learnOpener = { current: null as 'help' | null };

/** Learn: every lesson, or one of them by its task (views/LearnDialog.tsx). */
export function useOpenLearn() {
  const { open } = useDialogParam('learn');
  return useCallback((lesson: string = 'lessons') => open(lesson), [open]);
}

const DEFAULT_SETUP_ENGINE = 'codex-cli';

/**
 * Connecting one provider, drilled into from anywhere.
 *
 * This deliberately leaves `settings` alone. Opened from a provider row, the
 * dialog stacks on top of Settings and closing it puts you back on the row you
 * clicked, still in the list, with its state already updated. Closing Settings
 * first was correct while only Codex had a setup dialog and only the composer
 * opened it; from inside the list it read as being thrown out of the pane.
 *
 * Opened from the composer, where there is no `settings` in the URL, nothing
 * stacks and the dialog is simply the dialog.
 */
export function useOpenSetup() {
  const { open } = useDialogParam('setup');
  return useCallback(
    (engineId: string = DEFAULT_SETUP_ENGINE) => {
      // Called straight from an onClick in one place, which would otherwise
      // pass a click event in as the engine id.
      open(typeof engineId === 'string' ? engineId : DEFAULT_SETUP_ENGINE);
    },
    [open],
  );
}

/**
 * What a dialog does with focus the moment it opens.
 *
 * Radix aims at the first tabbable thing inside, which in almost every dialog
 * here is the close button — so the dialog arrives wearing a ring around its
 * ×, and a ring on a control nobody aimed at reads as an error. Focusing the
 * surface itself keeps everything that matters: the trap, Escape, and the
 * announcement a screen reader makes when focus enters a labelled dialog.
 *
 * Stated once because six dialogs had been writing it out by hand, and the two
 * that had not were the ones showing the ring.
 */
export function focusSelfOnOpen(e: Event): void {
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
}
