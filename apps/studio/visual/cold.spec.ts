import { test } from '@playwright/test';
import { isolate } from '../e2e/harness.js';
import { discover, prep, shot, type Discovered } from './shared.js';

/**
 * The cold half: no owned scene, so the Scenes library leads with its
 * first-run offer — the state library-cold.spec.ts protects behaviourally.
 */

isolate();

let d: Discovered;
test.beforeAll(async ({ request }) => {
  d = await discover(request);
});

test('scenes library, cold', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/scenes`);
  await shot(page, 'scenes-cold');
});
