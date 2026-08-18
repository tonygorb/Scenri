// ---------------------------------------------------------------- focus

/**
 * Stop a control from taking the caret out of the brief.
 *
 * Put this on the CONTAINER of anything that inserts into the line (the plus
 * menu, the attach panel, the token menu) rather than on each button. Guarding
 * one control at a time is how the plus button stayed broken for three rounds
 * while its siblings were fixed; a container guard covers everything inside it,
 * including whatever gets added later.
 *
 * Cancelling mousedown is what keeps the caret: Chromium re-establishes an
 * editing caret only on a real focus transition, so once focus has genuinely
 * left the line, putting it back programmatically is reported but not honoured.
 * Fields the user has to type into are exempt, and they use the caret fallback.
 */
export function keepCaret(e: { target: EventTarget | null; preventDefault(): void }): void {
  const el = e.target as HTMLElement | null;
  if (el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
  e.preventDefault();
}
