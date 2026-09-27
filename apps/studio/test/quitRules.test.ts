import { describe, expect, it } from 'vitest';
import { stoppedAnswer, waitUntilStopped } from '../src/app/quitRules.js';

/**
 * Shut down closes the tab only once the server is really gone, never over a
 * Scenri still running: a draining server answering 503, and a dev proxy
 * answering 5xx for a server that has gone, both count as stopped.
 */
describe('waiting for Scenri to stop', () => {
  const noSleep = async () => {};

  it('reads anything but a 200 as stopped', () => {
    expect(stoppedAnswer(null)).toBe(true);
    expect(stoppedAnswer(503)).toBe(true);
    expect(stoppedAnswer(502)).toBe(true);
    expect(stoppedAnswer(200)).toBe(false);
  });

  it('is done the moment the server stops answering', async () => {
    const answers = [200, 200, 503];
    let asked = 0;
    const gone = await waitUntilStopped(async () => answers[asked++] ?? null, {
      boundMs: 1000,
      stepMs: 100,
      sleep: noSleep,
    });
    expect(gone).toBe(true);
    expect(asked).toBe(3);
  });

  it('gives up on a server that keeps answering, so the tab stays', async () => {
    let asked = 0;
    const gone = await waitUntilStopped(
      async () => {
        asked++;
        return 200;
      },
      { boundMs: 1000, stepMs: 250, sleep: noSleep },
    );
    expect(gone).toBe(false);
    expect(asked).toBe(5);
  });
});
