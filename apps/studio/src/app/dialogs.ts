import { useCallback } from 'react';
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

export type Pane = 'brand' | 'engines' | 'budget' | 'usage' | 'library' | 'appearance' | 'about' | 'danger';

/** Settings, at a pane. A URL, so it survives a refresh and answers to Back. */
export function useOpenSettings() {
  const { open } = useDialogParam('settings');
  return useCallback((pane: Pane = 'brand') => open(pane), [open]);
}

/** Codex, because the setup dialog opened without an engine is the Codex one. */
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
