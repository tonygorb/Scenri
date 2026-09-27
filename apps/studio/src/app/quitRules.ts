/**
 * Shut down, from the studio's side. The server says yes (or its socket dies
 * mid-reply, which is the same stop); then the tab waits until the server is
 * really gone before it says it has stopped and closes, so a tab never goes
 * away over a Scenri still running. Still answering after the bound means it
 * did not stop, and the tab stays where it was.
 */

export type QuitOutcome = { kind: 'stopped' } | { kind: 'refused'; reason: string } | { kind: 'still-running' };

/**
 * Whether an answer to /api/version says the server has stopped: anything but
 * a 200. A refused connection is the plain case; a draining server answers
 * 503, and through the dev proxy a server that is gone is a 5xx.
 */
export const stoppedAnswer = (status: number | null): boolean => status !== 200;

/** Ask until the server has stopped (true) or the bound runs out while it still answers (false). */
export async function waitUntilStopped(
  ask: () => Promise<number | null>,
  opts: { boundMs: number; stepMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<boolean> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let waited = 0; waited <= opts.boundMs; waited += opts.stepMs) {
    if (stoppedAnswer(await ask())) return true;
    await sleep(opts.stepMs);
  }
  return false;
}
