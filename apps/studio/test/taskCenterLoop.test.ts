import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The bell's one poll loop. A poke, a focus or a tab coming back re-arms it,
 * and one that lands while a look is still out must not leave a second loop
 * running beside the first.
 */
const api = vi.hoisted(() => ({ activity: vi.fn(), assetBuilds: vi.fn() }));
vi.mock('../src/api.js', () => ({ api }));
vi.mock('react-router', () => ({ useNavigate: () => () => {}, useLocation: () => ({ pathname: '/b' }) }));
vi.mock('../src/toasts.js', () => ({ useToasts: () => ({ push: () => {} }) }));
vi.mock('../src/app/AppShell.js', () => ({ useAppData: () => ({ refreshBrands: async () => {} }) }));

const { TaskCenterProvider, useTaskCenter } = await import('../src/app/TaskCenter.js');

const quiet = { nodes: [], jobs: [], studio: [], boot: 'boot-1' };
let host: HTMLDivElement;
let root: Root;
let poke: () => void;

function Probe() {
  poke = useTaskCenter().poke;
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  api.activity.mockReset();
  api.assetBuilds.mockReset().mockResolvedValue({ builds: [] });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("the bell's poll", () => {
  it('stays one loop when a poke lands while a look is still out', async () => {
    let answer: (v: typeof quiet) => void = () => {};
    api.activity
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      )
      .mockResolvedValue(quiet);
    await act(async () => {
      root.render(createElement(TaskCenterProvider, { brand: { id: 'b1', slug: 'b' } as never }, createElement(Probe)));
    });
    expect(api.activity).toHaveBeenCalledTimes(1);

    await act(async () => poke());
    await act(async () => answer(quiet));
    api.activity.mockClear();

    // idle, so one look every five seconds: three waits, three looks
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(api.activity).toHaveBeenCalledTimes(3);
  });
});
