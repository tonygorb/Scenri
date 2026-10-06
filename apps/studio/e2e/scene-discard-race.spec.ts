import { expect, type Locator, type Page, test } from '@playwright/test';
import { arrived, isolate } from './harness.js';
import { currentBrand } from './realtime.js';

/**
 * A place draft discarded on the Places wall while its studio is open in
 * another tab (SC-H8). The point is a discard that lands while the draw is
 * still running, so the draw here is long: thirty seconds, which a stop cuts
 * short at once (the demo engine's sleep wakes on the abort). In
 * scene-hardening.spec.ts it shared a 1.2s draw, and on a loaded runner the
 * draw finished before the second tab had found its card, so the studio said
 * "Here is the place" instead of "Stopped" (CI, 2026-10-06, both attempts).
 */
isolate({
  env: {
    SCENRI_DEMO_BUILDS: '1',
    SCENRI_DEMO_REFS: '5',
    SCENRI_DEMO_DELAY_MS: '30000',
    SCENRI_DEMO_ANALYSIS: 'usable',
    SCENRI_DEMO_READ_MS: '300',
  },
  library: true,
  // the harness seeds a finished shot through the same engine, which a thirty
  // second draw would outlast; nothing here needs one
  shot: false,
});

const studio = (p: Page) => p.locator('.sc-pstudio[data-kind="scene"]');
const openQ = (p: Page) => studio(p).locator('[data-turn^="q:"]').last();
const live = (p: Page) => studio(p).locator('[data-turn^="q:"]:not([data-picked])').last();
const line = (p: Page) => studio(p).locator('.sc-pstudio-foot textarea');
const pill = (p: Page) => studio(p).locator('.sc-convo-send');

async function say(p: Page, text: string) {
  await line(p).fill(text);
  await line(p).press('Enter');
}

async function tap(q: Locator, name: string) {
  await q.getByRole('button', { name, exact: true }).click();
}

/** A new place conversation, on its first question. */
async function start(p: Page): Promise<string> {
  const { slug } = await currentBrand(p);
  await p.goto(`/${slug}/places/new`);
  await arrived(p, '.sc-pstudio[data-kind="scene"]');
  await expect(studio(p).locator('[data-turn="q:source"]')).toBeVisible();
  return slug;
}

/** A place said in one sentence, every follow-up left to the reading, up to the read-back. */
async function place(p: Page, sentence: string) {
  await say(p, sentence);
  let passed = '';
  for (let i = 0; i < 5; i++) {
    const q = live(p);
    if (passed) await expect(q).not.toHaveAttribute('data-turn', passed, { timeout: 30_000 });
    await expect(q).toHaveAttribute('data-turn', /^q:(world|surface|light|signature|agree-|decide-|name)/, {
      timeout: 30_000,
    });
    const id = (await q.getAttribute('data-turn')) ?? '';
    if (!/^q:(world|surface|light|signature)$/.test(id)) break;
    await tap(q, 'Leave it to the reading');
    passed = id;
  }
  await expect(openQ(p)).toHaveAttribute('data-turn', /^q:agree-/, { timeout: 30_000 });
}

async function draw(p: Page) {
  const agree = openQ(p);
  await expect(agree).toContainText('What your shots are told');
  await tap(agree, 'Draw the place');
}

test.describe('two tabs', () => {
  test('a draft discarded on the wall stays gone while its studio is open in another tab (SC-H8)', async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const slug = await start(page);
    const convo = new URL(page.url()).pathname.split('/').pop() as string;
    await place(page, 'A misty pine forest at dawn');
    await draw(page);
    await expect(pill(page)).toHaveText('Stop');
    const wall = await context.newPage();
    await wall.goto(`/${slug}/places`);
    const card = wall.locator(`.sc-lookcard[data-build]:has(a[href$="${convo}"])`);
    await expect(card).toBeVisible();
    await card.hover();
    await card.locator('.sc-cardpuck').click();
    await wall.getByRole('alertdialog').getByRole('button', { name: 'Discard', exact: true }).click();
    // the draft goes once its draw has heard the Stop, which a loaded machine takes a while to say
    await expect(card).toHaveCount(0, { timeout: 20_000 });
    // the studio tab hears its job stopped
    await expect(studio(page)).toContainText(/Stopped|stopped/, { timeout: 15_000 });
    // the wall, read again: the discarded draft is not back
    await wall.reload();
    await expect(wall.locator('.sc-owned, .sc-lookcard').first()).toBeVisible();
    await expect(wall.locator(`.sc-lookcard[data-build]:has(a[href$="${convo}"])`)).toHaveCount(0);
  });
});
