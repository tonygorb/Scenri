import type { FastifyInstance } from 'fastify';

/**
 * Wait for a node to reach a terminal status.
 *
 * `POST /api/nodes` answers 202 and runs the engine in the background, so a
 * test that tears down straight after the request closes the database out from
 * under work that is still in flight. Drain with this before `app.close()`.
 *
 * The budget is a deadline for background work, not an assertion about speed.
 * At 50 polls it was 2.5 seconds, and a two image demo generation on a busy
 * machine was measured finishing in 2272ms: close enough that the suite failed
 * whenever anything else was competing for the CPU, while the same test passed
 * alone. Ten seconds is still short enough to fail fast on a genuine hang.
 */
export async function waitDone(app: FastifyInstance, nodeId: string, tries = 200): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/nodes/${nodeId}` });
    const node = res.json();
    if (node.status !== 'running') return node;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('node never finished');
}

/**
 * Wait for the delivered-pixels record, which lands after the node is done.
 *
 * `completeNode` flips the status, and only then does the run read each image
 * back through sharp to write `brief.rendered` (server.ts). A node is therefore
 * genuinely done for a moment before that record exists, and `waitDone` polls
 * on the status, so it can hand back a snapshot taken inside that window. That
 * is exactly what it did on a loaded Linux runner: status done, two images, and
 * `rendered` undefined.
 *
 * The ordering is deliberate — the record is a convenience and must never be
 * able to fail a finished run — so a test that asserts on it waits for it,
 * rather than the run being made to wait for the record.
 */
export async function waitRendered(app: FastifyInstance, nodeId: string, tries = 200): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/nodes/${nodeId}` });
    const node = res.json();
    if (node.brief?.rendered) return node;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('node never recorded what it rendered');
}
