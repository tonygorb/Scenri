import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * A shot that fails stops looking like one being made, and nobody has to
 * reload for it. The demo engine here refuses the first slot of every run,
 * after long enough for the running tile to be seen, so a one-shot send always
 * fails and so does its Try again: the shape of an engine that is out of
 * credit. No seeded shot, since the seed has to finish.
 */
isolate({ shot: false, env: { SCENRI_DEMO_FAIL_SLOT: '0', SCENRI_DEMO_DELAY_MS: '1200' } });

test.beforeEach(async ({ page }, testInfo) => {
  await page.bringToFront();
  testInfo.setTimeout(90_000);
});

const line = (p: Page) => p.locator('.sc-brief-line').first();
const dock = (p: Page) => p.locator('.sc-canvas-dock').first();
const tile = (p: Page, id: string) => p.locator(`.sc-cell[data-fb-node="${id}"]`);

async function brand(p: Page): Promise<{ id: string; slug: string }> {
  return (await (await p.request.get('/api/brands')).json())[0];
}

async function openCreate(p: Page, slug: string, sort: 'newest' | 'oldest' = 'newest') {
  await p.goto(`/${slug}/create`);
  await p.evaluate((s) => {
    localStorage.setItem('scenri:count', '1');
    localStorage.setItem('scenri:feed-sort', JSON.stringify(s));
  }, sort);
  await p.goto(`/${slug}/create`);
  await expect(line(p)).toBeVisible();
}

async function sendOne(p: Page, said: string): Promise<string> {
  const answered = p.waitForResponse((r) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST');
  await line(p).click();
  await p.keyboard.type(said);
  await dock(p).locator('.sc-send').click();
  const ids = ((await (await answered).json()).siblings as { id: string }[]).map((s) => s.id);
  expect(ids).toHaveLength(1);
  return ids[0];
}

async function expectSettledFailed(p: Page, id: string) {
  await expect(tile(p, id)).toHaveAttribute('data-failed', /.+/, { timeout: 20_000 });
  await expect(tile(p, id)).not.toHaveAttribute('data-running');
  await expect(tile(p, id).locator('.sc-rendering')).toHaveCount(0);
}

test('a shot that fails trades its swirl for the failure, with no reload', async ({ page }) => {
  const { slug } = await brand(page);
  await openCreate(page, slug);
  const id = await sendOne(page, 'this one will not make it');
  await expect(tile(page, id)).toHaveAttribute('data-running', 'true');
  await expectSettledFailed(page, id);
});

test('a Try again that fails again settles as well', async ({ page }) => {
  const { slug } = await brand(page);
  await openCreate(page, slug);
  const id = await sendOne(page, 'refused twice');
  await expectSettledFailed(page, id);

  await tile(page, id).getByRole('button', { name: 'Try again' }).click();
  await expect(tile(page, id)).toHaveAttribute('data-running', 'true');
  await expectSettledFailed(page, id);
});

test('a Try again on a card behind sixty newer shots settles as well', async ({ page }) => {
  const b = await brand(page);
  // oldest first, so the card stays the first tile however many come after it
  await openCreate(page, b.slug, 'oldest');
  const id = await sendOne(page, 'the card that ends up far behind');
  await expectSettledFailed(page, id);

  // sixty newer shots, each refused the same way
  const ws = await (await page.request.get(`/api/brands/${b.id}/workspace`)).json();
  for (let i = 0; i < 60; i++) {
    const r = await page.request.post('/api/nodes', {
      data: {
        projectId: ws.project.id,
        kind: 'generation',
        engineId: 'demo',
        count: 1,
        prompt: `a newer shot ${i}`,
        width: 512,
        height: 512,
      },
    });
    expect(r.status()).toBe(202);
  }
  const activity = async () =>
    (await (await page.request.get(`/api/brands/${b.id}/activity`)).json()).nodes as {
      id: string;
      status: string;
    }[];
  await expect
    .poll(async () => (await activity()).filter((n) => n.status === 'running').length, { timeout: 30_000 })
    .toBe(0);
  // the precondition this case is about: the card has left the activity window
  expect((await activity()).some((n) => n.id === id)).toBe(false);

  await page.reload();
  await expect(tile(page, id)).toHaveAttribute('data-failed', /.+/);
  await tile(page, id).getByRole('button', { name: 'Try again' }).click();
  await expect(tile(page, id)).toHaveAttribute('data-running', 'true');
  await expectSettledFailed(page, id);
});
