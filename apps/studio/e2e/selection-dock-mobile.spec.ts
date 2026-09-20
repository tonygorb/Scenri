import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The selection dock on a phone.
 *
 * It used to be the desktop pill squeezed: four labelled buttons wrapped into
 * three lines with `Clear` stranded on the last. It is now the same toolbar a
 * pointer gets, at one scale: the same 17px glyphs and the same word, in a
 * box two pixels larger, hugging its own contents rather than stretching to
 * the gutters. What this test guards is exactly that: one row, nothing
 * shrunk, nothing off the screen, and a target a thumb can find.
 */
isolate();

async function seedShots(page: Page, count: number): Promise<string> {
  await page.goto('/');
  await page.waitForURL((u) => u.pathname.split('/').filter(Boolean).length === 1);
  const slug = decodeURIComponent(new URL(page.url()).pathname.split('/')[1]);
  const brands = (await (await page.request.get('/api/brands')).json()) as { id: string; slug: string }[];
  const id = brands.find((b) => b.slug === slug)?.id ?? brands[0].id;
  const ws = (await (await page.request.get(`/api/brands/${id}/workspace`)).json()) as {
    project: { id: string };
    root: string;
  };
  await page.request.post('/api/nodes', {
    data: {
      projectId: ws.project.id,
      parentId: ws.root,
      kind: 'generation',
      prompt: 'a shelf',
      engineId: 'demo',
      count,
    },
  });
  await expect
    .poll(async () => {
      const feed = (await (await page.request.get(`/api/brands/${id}/feed?limit=50`)).json()) as {
        items: { status: string }[];
      };
      return feed.items.filter((n) => n.status === 'done').length;
    })
    .toBeGreaterThanOrEqual(count);
  return slug;
}

const cells = (p: Page) => p.locator('.sc-cell[data-fb-node]');
const bar = (p: Page) => p.locator('.sc-picked');

/**
 * Starting a selection without a pointer is the tile menu's own verb: the tick
 * stays hidden until it means something (canvas.css), and the menu is reached
 * by the overflow the tile carries on every touch screen.
 */
async function startSelection(page: Page) {
  await cells(page).first().locator('.sc-cell-more').tap();
  await page.getByRole('menuitem', { name: 'Select for set' }).click();
  await expect(bar(page)).toBeVisible();
}

test('the dock is one row on a phone, fits its contents and stays on screen', async ({ page }) => {
  test.setTimeout(90_000);
  const slug = await seedShots(page, 2);
  await page.goto(`/${slug}/create`);
  await expect(cells(page).first()).toBeVisible();
  await startSelection(page);

  const shape = await bar(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const tools = [...el.querySelectorAll<HTMLElement>('.sc-picked-tool')];
    const rows = new Set(tools.map((b) => Math.round(b.getBoundingClientRect().top)));
    return {
      width: Math.round(r.width),
      inner: window.innerWidth,
      rows: rows.size,
      tool: Math.min(...tools.map((b) => Math.round(b.getBoundingClientRect().height))),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      names: [...el.querySelectorAll('button')].map(
        (b) => b.getAttribute('aria-label') ?? (b.textContent || '').trim(),
      ),
    };
  });

  expect(shape.overflow).toBe(false);
  expect(shape.names).toEqual(['Select all', 'Keep', 'Add to set', 'Archive', 'Done']);
  // one row at every width, and the bar is as wide as its contents rather
  // than the screen: a bar that fills the gutters is a panel, not a toolbar
  expect(shape.rows).toBe(1);
  expect(shape.width).toBeLessThan(shape.inner * 0.9);
  // below the dock's breakpoint the box is the pointer's 32 plus two; a
  // tablet is past it and keeps the pointer's own, which is the point of
  // there being one scale rather than two compositions
  expect(shape.tool).toBeGreaterThanOrEqual(shape.inner < 768 ? 34 : 32);
});

test('archiving a selection by thumb takes the shots and the shelf away', async ({ page }) => {
  test.setTimeout(90_000);
  const slug = await seedShots(page, 2);
  await page.goto(`/${slug}/create`);
  await expect(cells(page).first()).toBeVisible();
  const before = await cells(page).count();
  await startSelection(page);

  await bar(page).getByRole('button', { name: 'Archive' }).tap();
  await expect(cells(page)).toHaveCount(before - 1);
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator('.sc-toast', { hasText: 'Archived 1 shot' })).toBeVisible();
});
