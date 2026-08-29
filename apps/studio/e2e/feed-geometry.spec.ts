import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The on-screen box of every rendered image matches the file's own pixels.
 *
 * This is the check nothing performed the day a sheared generation shipped:
 * every surface was in fact faithful, but no test could say so. It proves the
 * UI half of the geometry contract - a tile or stage can crop, letterbox or
 * size to content, but it may never stretch a picture's ratio. A sheared FILE
 * still passes here by design: its ratio is self-consistent, and only the
 * fixture suite (packages/cli/test/geometry.test.ts) can see shear.
 */

isolate();

const api = async (p: Page, path: string, init?: RequestInit) =>
  p.evaluate(
    async ([u, i]) => {
      const r = await fetch(u as string, i as RequestInit);
      return r.json();
    },
    [path, init ?? undefined],
  );

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const FORMATS = [
  { id: 'square', w: 256, h: 256 },
  { id: 'portrait', w: 256, h: 320 },
  { id: 'landscape', w: 400, h: 225 },
  { id: 'story', w: 216, h: 384 },
];

/** Every visible img whose box ratio differs from its natural ratio beyond 2%. */
const stretchedImages = (p: Page, selector: string) =>
  p.$$eval(selector, (imgs) =>
    (imgs as HTMLImageElement[])
      .filter((el) => el.naturalWidth > 0 && el.getBoundingClientRect().width > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { src: el.currentSrc.slice(-24), box: r.width / r.height, nat: el.naturalWidth / el.naturalHeight };
      })
      .filter(({ box, nat }) => Math.abs(box - nat) / nat > 0.02),
  );

test('feed tiles and the detail stage never stretch a picture', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(page.url()).pathname.split('/')[1]);
  const brands = (await api(page, '/api/brands')) as any[];
  const brandId = brands.find((b) => b.slug === slug).id;
  const ws = (await api(page, `/api/brands/${brandId}/workspace`)) as any;

  const made: string[] = [];
  for (const f of FORMATS) {
    const node = (await api(
      page,
      '/api/nodes',
      postJson({
        projectId: ws.project.id,
        kind: 'generation',
        engineId: 'demo',
        count: 1,
        brief: {
          tokens: [
            { t: 'format', id: f.id, w: f.w, h: f.h },
            { t: 'text', v: `geometry probe ${f.id}` },
          ],
        },
      }),
    )) as any;
    made.push(node.id);
  }
  await expect
    .poll(
      async () => {
        const now = (await api(page, `/api/brands/${brandId}/workspace`)) as any;
        return made.filter((id) => now.nodes.find((n: any) => n.id === id)?.status === 'done').length;
      },
      { timeout: 30_000 },
    )
    .toBe(FORMATS.length);

  await page.goto(`/${slug}/create`);
  await expect(page.locator('.sc-cellimg img').first()).toBeVisible();
  // let every tile finish loading before measuring
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.sc-cellimg img')].every((el) => (el as HTMLImageElement).naturalWidth > 0),
  );
  expect(await stretchedImages(page, '.sc-cellimg img')).toEqual([]);

  // the detail stage, on the portrait shot
  await page.locator('.sc-cell').first().click();
  const stageImg = page.locator('.sc-frame img').first();
  await expect(stageImg).toBeVisible();
  await page.waitForFunction(() => {
    const el = document.querySelector('.sc-frame img') as HTMLImageElement | null;
    return !!el && el.naturalWidth > 0;
  });
  expect(await stretchedImages(page, '.sc-frame img')).toEqual([]);
});
