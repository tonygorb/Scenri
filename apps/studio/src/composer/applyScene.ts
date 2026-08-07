/**
 * The shared decision behind every "attach a Scene" entry point: the rail, the
 * AttachPanel's Scenes tab, the `#`/`/` sigil menu, and the URL-driven `?scene=`
 * seed all ask the same question — did anything actually change, and if so,
 * what does the user need to be told? No React here, so it can be called both
 * live (against already-rendered state) and during hydration (against raw
 * persisted-draft data, before anything has rendered at all).
 */
export interface SceneSwitchResult {
  changed: boolean;
  toast: { title: string; prevSceneId: string | null; branchWasCleared: boolean } | null;
}

export function resolveSceneSwitch(
  existingSceneId: string | null,
  newSceneId: string,
  sceneName: string,
  branchId: string | null,
  branchLabel: string | null,
): SceneSwitchResult {
  // re-picking the same scene is a true no-op: no swap, no toast, no history
  if (existingSceneId === newSceneId) return { changed: false, toast: null };
  // a scene always implies a fresh setup, so an active branch target is dropped
  // alongside it (Composer.tsx's own effect enforces the drop; this only names it)
  const branchWasCleared = !!branchId;
  // a first-time attach onto an empty slot, with nothing else disturbed, is not
  // worth announcing — a toast here would be noise, not signal
  if (existingSceneId === null && !branchWasCleared) return { changed: true, toast: null };
  const title = branchWasCleared
    ? `Switched to ${sceneName}. This starts a new shot instead of refining ${branchLabel ?? 'that shot'}.`
    : `Switched to ${sceneName}.`;
  return { changed: true, toast: { title, prevSceneId: existingSceneId, branchWasCleared } };
}
