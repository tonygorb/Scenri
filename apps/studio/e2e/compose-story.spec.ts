import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, type Locator, test } from '@playwright/test';
import {
  type Beat,
  barrierCream,
  beatsOf,
  composeStory,
  type Director,
  direct,
  makeFromShowcase,
  seedStoryBrand,
  storyPrefs,
} from './composeStory.js';
import { isolate } from './harness.js';

// A fresh install that has the library, so the catalog's products are on offer, and a demo engine
// that reads references the way a real one does (at zero it dims both chips).
isolate({ brand: false, library: true, env: { SCENRI_DEMO_REFS: '5', SCENRI_DEMO_DELAY_MS: '600' } });

test('the compose story walks from Home to a refined shot, on its own library', async ({ page, request }) => {
  test.setTimeout(150_000);

  // the story runs on this file's own home, never the machine's library
  const { home } = (await (await request.get('/api/version')).json()) as { home: string };
  expect(home).not.toBe(join(homedir(), '.scenri'));
  expect(home).toContain('sc-e2e-');

  // one public, fictional brand, and nothing else in the home
  const brand = await seedStoryBrand(request, barrierCream);
  const brands = (await (await request.get('/api/brands')).json()) as { json?: { meta?: { name?: string } } }[];
  expect(brands.map((b) => b.json?.meta?.name)).toEqual([barrierCream.brand]);

  const reached: Beat[] = [];
  const checked: Director = {
    ...direct,
    beat: async (name) => void reached.push(name),
    // every control the story presses is live when it is pressed
    click: async (target: Locator) => {
      await expect(target).not.toHaveAttribute('aria-disabled', 'true');
      await target.click();
    },
  };
  await storyPrefs(page);
  // the brand's earlier work, one picture a recipe, before the story starts
  for (const id of barrierCream.history) await makeFromShowcase(page, brand.slug, id);
  // what Generate sends: the prompt as written, both ingredients and every word around them
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/nodes') && r.method() === 'POST');
  // warmed, as a film walks it: Create and back first, so every known picture shows at once
  const { shotId, refinedIds } = await composeStory(page, barrierCream, brand.slug, checked, { warm: true });

  expect(reached).toEqual(beatsOf(barrierCream));
  const body = JSON.stringify((await sent).postDataJSON());
  for (const part of barrierCream.line) {
    expect(body).toContain(typeof part === 'string' ? part.trim() : part.token.slice(2));
  }

  // the new shot joined the brand's history rather than replacing it
  const feed = (await (await request.get(`/api/brands/${brand.id}/feed?limit=60`)).json()) as {
    items: { id: string }[];
  };
  expect(feed.items.map((i) => i.id)).toContain(shotId);
  expect(feed.items.length).toBeGreaterThanOrEqual(barrierCream.history.length + 1);

  // each refinement is made from the step before it, and the trail names every step in its own words
  let parent = shotId;
  for (const id of refinedIds) {
    const node = (await (await request.get(`/api/nodes/${id}`)).json()) as { parentId: string };
    expect(node.parentId).toBe(parent);
    parent = id;
  }
  await expect(page.locator('.sc-ovl-head b')).toHaveText(`Refinement ${refinedIds.length}`);
  for (const [i, words] of barrierCream.refinements.entries()) {
    await expect(page.locator('.sc-thumbs .sc-trail-tile').nth(i + 1)).toHaveAttribute(
      'aria-label',
      `Refinement ${i + 1}: ${words}`,
    );
  }
});
