/**
 * The shared decision behind every "attach a Look" entry point: the rail, the
 * AttachPanel's Looks tab, the `#`/`/` sigil menu, and the URL-driven `?look=`
 * seed all ask the same question — did anything actually change, and if so,
 * what does the user need to be told? No React here, so it can be called both
 * live (against already-rendered state) and during hydration (against raw
 * persisted-draft data, before anything has rendered at all).
 */
export interface LookSwitchResult {
  changed: boolean;
  toast: { title: string; prevLookId: string | null; branchWasCleared: boolean } | null;
}

export function resolveLookSwitch(
  existingLookId: string | null,
  newLookId: string,
  lookName: string,
  branchId: string | null,
  branchLabel: string | null,
): LookSwitchResult {
  // re-picking the same look is a true no-op: no swap, no toast, no history
  if (existingLookId === newLookId) return { changed: false, toast: null };
  // a look always implies a fresh setup, so an active branch target is dropped
  // alongside it (Composer.tsx's own effect enforces the drop; this only names it)
  const branchWasCleared = !!branchId;
  // a first-time attach onto an empty slot, with nothing else disturbed, is not
  // worth announcing — a toast here would be noise, not signal
  if (existingLookId === null && !branchWasCleared) return { changed: true, toast: null };
  const title = branchWasCleared
    ? `Switched to ${lookName}. This starts a new shot instead of refining ${branchLabel ?? 'that shot'}.`
    : `Switched to ${lookName}.`;
  return { changed: true, toast: { title, prevLookId: existingLookId, branchWasCleared } };
}
