/**
 * Every server a test file builds, so teardown can settle all of them.
 *
 * A server owns a thumbnail queue that writes into the home directory, and it
 * keeps writing after the test body returns. Removing the home while one of
 * those writes is in flight is `ENOTEMPTY` on Linux and `EBUSY` on Windows,
 * reported against whichever test happened to be last. `rmSync`'s own retries
 * do not help: they wait on the directory rather than on the work.
 *
 * Draining is what settles the queue. The trap is that a file usually drains
 * the one server its `beforeEach` made and never the fifty its tests make -
 * `server.test.ts` built fifty-one and drained one, and failed CI that way.
 */

export interface Drainable {
  drain(): Promise<void>;
}

const open: Drainable[] = [];

/** Register a server as it is built. Returns it, so it can wrap the call. */
export function track<T extends Drainable>(app: T): T {
  open.push(app);
  return app;
}

/**
 * Settle every tracked server. Safe to call when none were built, and safe
 * when a test already closed one: a second drain resolves.
 *
 * Call this before removing the home, and close the core only after it - a
 * drained server closes the core on its way out, and closing twice throws.
 */
export async function drainTracked(): Promise<void> {
  for (const app of open.splice(0)) await app.drain().catch(() => {});
}
