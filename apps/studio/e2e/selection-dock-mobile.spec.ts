import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The selection dock on a phone.
 *
 * It was the desktop pill squeezed: a fit-content lozenge that wrapped its
 * verbs into three lines with `Clear` stranded on the last, at the pointer's
 * own 34px. Below the dock's breakpoint it is a shelf the width of the
 * composer: what is selected and the way out on one line, the verbs sharing
 * the next at a thumb's height.
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

test('the dock is a shelf on a phone: two rows, thumb-sized, inside the screen', async ({ page }) => {
  test.setTimeout(90_000);
  const slug = await seedShots(page, 2);
  await page.goto(`/${slug}/create`);
  await expect(cells(page).first()).toBeVisible();
  await startSelection(page);

  const shape = await bar(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const rows = new Set([...el.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top)));
    return {
      width: Math.round(r.width),
      inner: window.innerWidth,
      rows: rows.size,
      shortest: Math.min(
        ...[...el.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().height)),
      ),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      verbs: [...el.querySelectorAll('button')].map((b) => (b.textContent || '').trim()),
    };
  });

  expect(shape.overflow).toBe(false);
  expect(shape.verbs).toEqual(['Keep', 'Archive', 'Add to set', 'Clear']);
  if (shape.inner < 768) {
    // the shelf takes the width it is given, in two rows: the way out beside
    // the count, the verbs under it, each a thumb's target (WCAG 2.5.5)
    expect(shape.width).toBeGreaterThan(shape.inner * 0.75);
    expect(shape.rows).toBe(2);
    expect(shape.shortest).toBeGreaterThanOrEqual(44);
  } else {
    // a tablet has the room the pill was drawn for: one row, hugging its own
    // contents rather than stretching across the screen
    expect(shape.rows).toBe(1);
    expect(shape.width).toBeLessThan(shape.inner * 0.75);
  }
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
