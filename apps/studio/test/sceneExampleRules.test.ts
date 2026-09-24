import { describe, expect, it } from 'vitest';
import type { SceneExampleJob } from '../src/api.js';
import type { SceneExampleView } from '../src/brandAssets.js';
import { earlierRoles, exampleTiles } from '../src/sceneExampleRules.js';

const ex = (role: SceneExampleView['role'], over: Partial<SceneExampleView> = {}): SceneExampleView => ({
  role,
  url: `/api/images/${role}`,
  hash: role,
  earlier: false,
  with: 'product',
  ...over,
});
const job = (over: Partial<SceneExampleJob> = {}): SceneExampleJob => ({
  id: 'j1',
  status: 'running',
  roles: ['hero', 'close'],
  done: [],
  failed: [],
  current: 'hero',
  from: 'asset:x',
  subject: { kind: 'product', id: 'vial' },
  error: null,
  ...over,
});

describe("a scene's example tiles", () => {
  it('has a tile for every example on its way from the first moment, so the rail never jumps', () => {
    expect(exampleTiles([], job()).map((t) => [t.role, t.state])).toEqual([
      ['hero', 'drawing'],
      ['close', 'drawing'],
    ]);
  });

  it('keeps a drawn example shimmering until the brand this page holds has it', () => {
    // the run says the hero is done; the brand has not been read back yet
    expect(exampleTiles([], job({ done: ['hero'], current: 'close' })).map((t) => t.state)).toEqual([
      'drawing',
      'drawing',
    ]);
    // once the run is over, a missing example is simply not there: it was removed
    expect(exampleTiles([], job({ status: 'done', done: ['hero', 'close'], current: null }))).toEqual([]);
  });

  it('keeps the old picture under the shimmer while one is drawn again', () => {
    const [hero] = exampleTiles([ex('hero')], job({ roles: ['hero'] }));
    expect(hero).toEqual({ role: 'hero', state: 'drawing', url: '/api/images/hero', hash: 'hero' });
  });

  it('shows the ones kept in the set’s order, and a failed one as failed', () => {
    const tiles = exampleTiles(
      [ex('bold'), ex('hero'), ex('close', { setup: 'close' })],
      job({ status: 'done', roles: ['hands'], failed: [{ role: 'hands', error: 'no picture' }], current: null }),
    );
    expect(tiles.map((t) => [t.role, t.state])).toEqual([
      ['hero', 'shown'],
      ['close', 'shown'],
      ['hands', 'failed'],
      ['bold', 'shown'],
    ]);
    expect(tiles[1].setup).toBe('close');
    expect(tiles[2].error).toBe('no picture');
  });

  it('names the examples drawn from an earlier picture of the place', () => {
    expect(earlierRoles([ex('hero', { earlier: true }), ex('close')])).toEqual(['hero']);
    expect(earlierRoles(undefined)).toEqual([]);
  });
});
