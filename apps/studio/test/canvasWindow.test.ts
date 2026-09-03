import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { Theme } from '@radix-ui/themes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../src/layout/Canvas.js';
import type { FeedNode } from '../src/api.js';

/**
 * The feed mounts what a reader can reach, not the brand. Below the window
 * threshold every tile is in the DOM, exactly as before; above it a column
 * carries a spacer, a band of tiles and a spacer.
 */

const shot = (i: number): FeedNode =>
  ({
    id: `shot-${i}`,
    projectId: 'p',
    parentId: 'root',
    kind: 'generation',
    promptHead: `shot ${i}`,
    childCount: 0,
    engineId: 'demo',
    status: 'done',
    images: ['a'.repeat(32)],
    costUsd: 0,
    kept: false,
    error: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    brief: { tokens: [], format: 'portrait', rendered: { sizes: [[1024, 1280]] } },
    archived: false,
  }) as unknown as FeedNode;

let scroller: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom lays nothing out: the scroller is 900px tall and the feed 1200px wide
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains('sc-canvas') ? 900 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains('sc-feed') ? 1200 : 0;
    },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  scroller = document.createElement('div');
  scroller.className = 'sc-canvas';
  document.body.appendChild(scroller);
  root = createRoot(scroller);
});

afterEach(() => {
  act(() => root.unmount());
  scroller.remove();
  vi.unstubAllGlobals();
});

async function mount(count: number) {
  const nodes = Array.from({ length: count }, (_, i) => shot(count - i));
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(
          Theme,
          null,
          createElement(Canvas, {
            nodes,
            selectedId: null,
            onOpen: () => {},
            shotHref: (id: string) => `/b/create/shots/${id}`,
            onRetry: () => {},
            tile: 320,
          }),
        ),
      ),
    );
  });
  // the feed measures itself in an effect and writes one frame later
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe('the windowed feed', () => {
  it('mounts every tile of a small feed and no spacer', async () => {
    await mount(40);
    expect(scroller.querySelectorAll('.sc-cell[data-fb-node]')).toHaveLength(40);
    expect(scroller.querySelectorAll('.sc-feed-pad')).toHaveLength(0);
    expect(scroller.querySelectorAll('.sc-feed-col')).toHaveLength(3);
  });

  it('mounts a band of a large feed, the newest first, and holds the rest as spacers', async () => {
    await mount(300);
    const cells = [...scroller.querySelectorAll('.sc-cell[data-fb-node]')];
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(60);
    expect(cells[0].getAttribute('data-fb-node')).toBe('shot-300');
    // three columns, each starting with a tile and ending with a spacer
    const cols = [...scroller.querySelectorAll('.sc-feed-col')];
    expect(cols).toHaveLength(3);
    for (const col of cols) {
      expect(col.firstElementChild?.classList.contains('sc-cell')).toBe(true);
      expect(col.lastElementChild?.classList.contains('sc-feed-pad')).toBe(true);
    }
    // the top-left, the one to its right, the one below: the deal
    expect(cols[1].firstElementChild?.getAttribute('data-fb-node')).toBe('shot-299');
    expect(cols[0].children[1]?.getAttribute('data-fb-node')).toBe('shot-297');
  });
});
