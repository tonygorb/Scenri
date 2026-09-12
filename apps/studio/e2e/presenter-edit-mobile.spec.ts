import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { isolate } from './harness.js';

/** The editor on a phone: the same column as creation, the record's views in the strip. */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });

async function currentBrand(p: Page): Promise<{ slug: string; id: string }> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
  const brands = (await (await p.request.get('/api/brands')).json()) as { id: string; slug: string }[];
  return { slug, id: brands.find((b) => b.slug === slug)?.id ?? brands[0].id };
}

async function seedPresenter(req: APIRequestContext, brandId: string): Promise<string> {
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (
    await req.post(base, { data: { source: 'synthetic', direction: 'a woman in her 30s', name: 'Maren' } })
  ).json();
  await req.post(`${base}/${draft.id}/views/portrait/generate`, { data: {} });
  for (let i = 0; i < 200; i++) {
    const d = await (await req.get(`${base}/${draft.id}`)).json();
    if (d.views.portrait.status === 'candidate' && !d.activeView) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await req.post(`${base}/${draft.id}/views/portrait/approve`);
  const settle = async (view: string, want: string) => {
    for (let i = 0; i < 200; i++) {
      const d = await (await req.get(`${base}/${draft.id}`)).json();
      if (d.views[view].status === want && !d.activeView) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  // the full body is decided by hand like the face; the three-quarter decides itself
  await req.post(`${base}/${draft.id}/views/front/generate`, { data: {} });
  await settle('front', 'candidate');
  await req.post(`${base}/${draft.id}/views/front/approve`);
  await req.post(`${base}/${draft.id}/views/three-quarter/generate`, { data: { decide: 'auto' } });
  await settle('three-quarter', 'approved');
  return (await (await req.post(`${base}/${draft.id}/save`)).json()).presenter.id as string;
}

test('the phone editor stacks and keeps the composer in reach; the tablet keeps the rail', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await seedPresenter(page.request, brand.id);
  await page.goto(`/${brand.slug}/presenters/${id}/edit`);
  await expect(page.getByRole('log')).toContainText('What would you like to change about Maren?');
  const vw = page.viewportSize()!;
  const phone = vw.width < 768;
  // the strip of views belongs to the stage, and a phone has no stage
  await expect(page.locator('.sc-pstudio-slot')).toHaveCount(phone ? 0 : 3);
  // asked for, not waited on: a phone has no stage to measure
  const stage = (await page.locator('.sc-pstudio-stage').count())
    ? await page.locator('.sc-pstudio-stage').boundingBox()
    : null;
  const head = await page.locator('.sc-pstudio-head').boundingBox();
  const card = await page.locator('.sc-convo-card').boundingBox();
  expect(head && card).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  if (phone) {
    // no stage on a phone: the conversation is the screen, pictures and all
    expect(stage).toBeNull();
    expect(card!.y + card!.height).toBeLessThanOrEqual(vw.height + 1);
    // one close on a phone, the head's own
    await expect(page.getByRole('button', { name: 'Close' })).toHaveCount(1);
  } else {
    expect(stage!.x + stage!.width).toBeLessThanOrEqual(head!.x + 1);
  }
});
