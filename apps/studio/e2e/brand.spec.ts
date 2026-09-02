import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The brand kit, end to end.
 *
 * Everything here is a claim that only a real browser and a real server can
 * settle: that an edit reaches the stored document, that the stored document
 * reaches the prompt, and that the one bug this rewrite existed to kill — a
 * palette edit destroying the brand's neutrals — stays dead.
 */

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate({ scene: true });

const api = async (p: Page, path: string, init?: RequestInit) =>
  p.evaluate(
    async ([u, i]) => {
      const r = await fetch(u as string, i as RequestInit);
      return r.json();
    },
    [path, init ?? undefined],
  );

async function currentBrand(p: Page): Promise<{ id: string; slug: string; json: any }> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
  const brands = (await api(p, '/api/brands')) as any[];
  const b = brands.find((x) => x.slug === slug);
  return { id: b.id, slug, json: b.json };
}

const putBrand = (p: Page, id: string, brand: unknown) =>
  api(p, `/api/brands/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brand }),
  });

test.describe('brand kit', () => {
  test('the kit is a settings pane, and /kit still lands in it', async ({ page }) => {
    const brand = await currentBrand(page);

    // The nav slot went back to the work: no Brand tab.
    await expect(page.getByRole('button', { name: 'Brand', exact: true })).toHaveCount(0);

    // Every link that used to point at the page lands in the pane instead.
    await page.goto(`/${brand.slug}/kit`);
    await page.waitForURL(/\?settings=brand/);
    await expect(page.getByText('Brand kit', { exact: true }).first()).toBeVisible();
  });

  test('a palette edit persists and never eats the neutrals', async ({ page }) => {
    const brand = await currentBrand(page);
    // A kit with all four groups — the exact shape the old editor flattened.
    await putBrand(page, brand.id, {
      ...brand.json,
      palette: {
        primary: { hex: '#1F3D2B', name: 'Forest' },
        secondary: { hex: '#E8DCC8', name: 'Oat' },
        accent: [{ hex: '#D96C3B', name: 'Terracotta' }],
        neutrals: [{ hex: '#111111' }, { hex: '#FAFAF7' }],
      },
    });

    await page.goto(`/${brand.slug}?settings=brand`);
    const swatches = page.locator('.sc-pal-row');
    await expect(swatches).toHaveCount(5);
    // A colour is its swatch, a role the kit already knows, its hex and a way
    // to remove it. No per-row control asking a question the kit already answers.
    await expect(swatches.first().locator('button[role="checkbox"]')).toHaveCount(0);
    await expect(swatches.first().locator('.sc-pal-act[data-danger]')).toBeVisible();
    // Neutrals are shown as their own group rather than as a setting.
    await expect(page.locator('.sc-pal-group')).toHaveText('Neutrals');

    // Edit a neutral's hex. Any write at all used to collapse neutrals into
    // accents, permanently and silently.
    const neutralHex = swatches.nth(3).locator('.sc-pal-hex');
    await expect(swatches.nth(3).locator('.sc-pal-name')).toHaveText('Neutral');
    await neutralHex.fill('#222222');
    await neutralHex.blur();

    await expect
      .poll(async () => {
        const brands = (await api(page, '/api/brands')) as any[];
        return brands.find((b) => b.id === brand.id).json.palette;
      })
      .toMatchObject({
        primary: { hex: '#1F3D2B', name: 'Forest' },
        secondary: { hex: '#E8DCC8', name: 'Oat' },
        accent: [{ hex: '#D96C3B', name: 'Terracotta' }],
        neutrals: [{ hex: '#222222' }, { hex: '#FAFAF7' }],
      });

    await page.reload();
    await expect(page.locator('.sc-pal-row')).toHaveCount(5);
  });

  test('a colour added from the Create rail lands in the kit, not the brief', async ({ page }) => {
    const brand = await currentBrand(page);
    await putBrand(page, brand.id, {
      ...brand.json,
      palette: {
        primary: { hex: '#1F3D2B', name: 'Forest' },
        secondary: { hex: '#E8DCC8', name: 'Oat' },
        accent: [{ hex: '#D96C3B', name: 'Terracotta' }],
        neutrals: [{ hex: '#111111' }, { hex: '#FAFAF7' }],
      },
    });

    await page.goto(`/${brand.slug}/create`);
    // First-run keeps the rail open and has no toolbar switch. Once shots
    // exist the switch appears, and a blind click would shut a rail that
    // was already open.
    const toggle = page.getByRole('button', { name: 'Assets panel' });
    await expect(toggle.or(page.locator('[data-firstrun]'))).toBeVisible();
    if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
    }
    const rail = page.locator('aside.sc-assets');
    await expect(rail).toBeVisible();

    await rail.getByRole('button', { name: 'Add colour' }).click();
    const hex = page.locator('.sc-cp-hex');
    await expect(hex).toBeVisible();
    await hex.fill('#C8442A');
    await hex.press('Enter');

    // The plus writes the kit. A chip is a click on the swatch, not a side
    // effect of opening the picker.
    await expect(page.locator('.sc-brief-line .sc-token[data-kind="color"]')).toHaveCount(0);
    await expect(rail.getByTitle('Accent 2 #C8442A')).toBeVisible();
    await expect(rail.locator('.sc-agroup', { hasText: 'Brand colors' })).toHaveAttribute('data-mode', 'open');

    await rail.getByTitle('Accent 2 #C8442A').click();
    await expect(page.locator('.sc-brief-line .sc-token[data-kind="color"]')).toHaveCount(1);

    await expect
      .poll(async () => {
        const brands = (await api(page, '/api/brands')) as any[];
        return brands.find((b) => b.id === brand.id).json.palette;
      })
      .toMatchObject({
        primary: { hex: '#1F3D2B', name: 'Forest' },
        secondary: { hex: '#E8DCC8', name: 'Oat' },
        accent: [{ hex: '#D96C3B', name: 'Terracotta' }, { hex: '#C8442A' }],
        neutrals: [{ hex: '#111111' }, { hex: '#FAFAF7' }],
      });

    await rail.getByTitle('Accent 2 #C8442A').hover();
    await rail.getByRole('button', { name: 'Remove Accent 2' }).click();
    await expect(rail.getByTitle('Accent 2 #C8442A')).toHaveCount(0);
    await expect
      .poll(async () => {
        const brands = (await api(page, '/api/brands')) as any[];
        return brands.find((b) => b.id === brand.id).json.palette;
      })
      .toMatchObject({
        primary: { hex: '#1F3D2B', name: 'Forest' },
        secondary: { hex: '#E8DCC8', name: 'Oat' },
        accent: [{ hex: '#D96C3B', name: 'Terracotta' }],
        neutrals: [{ hex: '#111111' }, { hex: '#FAFAF7' }],
      });
  });

  test('rules apply on their own; nothing else about the brand does', async ({ page }) => {
    const brand = await currentBrand(page);
    await putBrand(page, brand.id, {
      ...brand.json,
      palette: { primary: { hex: '#1F3D2B', name: 'Forest' } },
      // Fields with no UI. They stay in the document and stay out of prompts.
      imagery: { mood: 'crafted and unhurried', avoid: ['neon'] },
      rules: { never: ['competitor logos in frame'] },
    });

    const preview = (brief: unknown) =>
      api(page, '/api/brief/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brandId: brand.id, engineId: 'demo', brief }),
      }) as Promise<{ prompt: string }>;

    // A boundary the user wrote needs no chip.
    const plain = await preview({ tokens: [{ t: 'text', v: 'a mug on a table' }] });
    expect(plain.prompt).toContain('Brand rules — never: competitor logos in frame.');
    // Taste never arrives uninvited, and the palette arrives only as a chip.
    expect(plain.prompt).not.toContain('Brand palette:');
    expect(plain.prompt).not.toContain('Brand look');

    const withColor = await preview({
      tokens: [
        { t: 'text', v: 'a mug' },
        { t: 'color', hex: '#1F3D2B', name: 'Forest' },
      ],
    });
    expect(withColor.prompt).toContain(
      'Use #1F3D2B as a defining color in the composition, in surfaces, materials and light, never as lettering.',
    );
  });

  test('the rules reach the shot without any chip or row in the composer', async ({ page }) => {
    const brand = await currentBrand(page);
    await putBrand(page, brand.id, { ...brand.json, rules: { never: ['competitor logos in frame'] } });

    // Rules are the brand's standing context, written in Settings and appended
    // by the compiler on its own (the preview test above pins the words). The
    // composer carries no row, no dropdown and no helper text about them.
    await page.goto(`/${brand.slug}/create?compose=1`);
    await expect(page.locator('.sc-brief-line')).toBeVisible();
    await expect(page.locator('.sc-inherit-head')).toHaveCount(0);

    // The chip that used to carry all this is gone from both places it lived.
    await page.locator('.sc-attach-toggle').first().click();
    await page.locator('.sc-ap-tabs button', { hasText: /brand/i }).click();
    await expect(page.locator('.sc-ap-card', { hasText: 'Brand kit' })).toHaveCount(0);
  });

  test('a mark can be attached to a shot, and is the first thing dropped', async ({ page }) => {
    const brand = await currentBrand(page);

    // Upload through the real multipart route, from the page's own origin.
    const hash = await page.evaluate(async (id) => {
      const png = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
        (c) => c.charCodeAt(0),
      );
      const fd = new FormData();
      fd.append('file', new Blob([png], { type: 'image/png' }), 'logo.png');
      const r = await fetch(`/api/brands/${id}/logos`, { method: 'POST', body: fd });
      const row = await r.json();
      return String(row.json.logos[0].file).slice(6);
    }, brand.id);
    expect(hash).toMatch(/^[a-f0-9]{32}$/);

    const compile = (engineId: string) =>
      api(page, '/api/brief/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandId: brand.id,
          engineId,
          brief: {
            tokens: [
              { t: 'text', v: 'a mug' },
              { t: 'mark', imageHash: hash },
            ],
          },
        }),
      }) as Promise<{
        prompt: string;
        attachments: { role: string }[];
        dropped: { role: string }[];
        warnings: string[];
      }>;

    // An engine that reads references carries the mark, and is told what it is.
    const carried = await compile('codex-cli');
    expect(carried.attachments.map((a) => a.role)).toContain('brand');
    expect(carried.prompt).toContain('reproduce it exactly as drawn');

    // One that reads none drops it and says so — and still compiles, because a
    // mark is decoration and losing decoration must never refuse a shot.
    const clamped = await compile('demo');
    expect(clamped.attachments).toHaveLength(0);
    expect(clamped.dropped.map((d) => d.role)).toEqual(['brand']);
    expect(clamped.warnings.join(' ')).toMatch(/left out/);

    // It shows up in the pane it is managed from.
    await page.goto(`/${brand.slug}?settings=brand`);
    await expect(page.locator('.sc-well img')).toBeVisible();
  });

  // The section this replaced asked users to describe how their pictures read.
  // Nobody could answer it. What survives is answerable in one tap.
  test('a brand rule is one tap, and reaches what the model receives', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}?settings=brand`);
    await expect(page.getByRole('heading', { name: 'We never' })).toBeVisible();
    // Nothing in the kit asks the user to invent language any more.
    await expect(page.getByRole('heading', { name: 'Look and feel' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Art direction' })).toHaveCount(0);

    const chip = page.locator('.sc-chips-sugg .sc-chip', { hasText: 'alcohol' });
    await expect(chip).toBeVisible();
    await chip.click();

    // It lands as a rule, and stops being offered.
    await expect(page.locator('.sc-chips-item', { hasText: 'alcohol' })).toBeVisible();
    await expect(page.locator('.sc-chips-sugg .sc-chip', { hasText: 'alcohol' })).toHaveCount(0);

    // What the model receives is the compiled prompt; the line accumulates
    // whatever rules the brand already had, so assert the rule is in it
    // rather than that it is the whole of it.
    await expect
      .poll(async () => {
        const { prompt } = (await api(page, '/api/brief/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            brandId: brand.id,
            engineId: 'demo',
            brief: { tokens: [{ t: 'text', v: 'a mug on a table' }] },
          }),
        })) as { prompt: string };
        return prompt.split('. ').find((d) => d.startsWith('Brand rules — never:')) ?? '';
      })
      .toContain('alcohol');
  });

  test('the kit exports as a .brand bundle', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}?settings=brand`);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Export', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.brand$/);
  });

  test('scenes are bookmarked from the card, not from a wizard', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/scenes`);
    const firstBookmark = page.locator('.sc-lookcard-bookmark').first();
    await firstBookmark.click();
    await expect(page.locator('.sc-lookcard-bookmark[data-on]')).toHaveCount(1);

    // The stored key keeps its historical spelling on purpose — renaming it
    // would need a fourth migration hop and risk a real user's list.
    const saved = await page.evaluate((id) => localStorage.getItem(`sc-favscenes-${id}`), brand.id);
    expect(JSON.parse(saved ?? '[]')).toHaveLength(1);
  });

  // Both cases below assert "the rail must not change shape as you bookmark
  // things", which is only a claim the page makes once the brand owns a scene:
  // `Scenes.tsx` sets `heroMode = !owned && !onlyMarked`, so a brand that owns
  // nothing leads with its offer and renders no chrome at all. `isolate({ scene:
  // true })` at the top of this file seeds that one owned scene, and nothing
  // outside this file sees it.
  test('the Bookmarks tab is always on the rail and filters the wall to what you bookmarked', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/scenes`);

    // Present at zero: the rail must not change shape as you bookmark things.
    const bmTab = page.getByRole('tab', { name: /Bookmarks/ });
    await expect(bmTab).toHaveCount(1);
    await expect(bmTab).toContainText('0');

    // Empty, it says what fills it — this is not a failed search.
    await bmTab.click();
    await expect(page.locator('.sc-lib-zero')).toContainText('Nothing bookmarked yet');
    await page.getByRole('button', { name: 'Browse every scene' }).click();
    await expect(page).not.toHaveURL(/[?&]bookmarked=1/);

    await page.locator('.sc-lookcard-bookmark').first().click();
    await expect(bmTab).toContainText('1');

    // Picking it collapses the collection sections into one flat wall.
    await bmTab.click();
    await expect(page).toHaveURL(/[?&]bookmarked=1/);
    await expect(page.locator('.sc-coll')).toHaveCount(0);
    await expect(page.locator('[data-wall] .sc-lookcard')).toHaveCount(1);

    // It survives a reload — the state is in the URL, not in a component.
    await page.reload();
    await expect(page.locator('[data-wall] .sc-lookcard')).toHaveCount(1);

    // Removing the last one falls back to the empty state, not a blank page,
    // and the tab stays put at zero.
    await page.locator('.sc-lookcard-bookmark[data-on]').first().click();
    await expect(page.locator('.sc-lib-zero')).toContainText('Nothing bookmarked yet');
    await expect(bmTab).toContainText('0');
    await page.getByRole('button', { name: 'Browse every scene' }).click();
    await expect(page).not.toHaveURL(/[?&]bookmarked=1/);
    await expect(page.locator('.sc-coll').first()).toBeVisible();
  });

  test('picking a vertical clears the Bookmarks tab rather than stacking with it', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/scenes`);
    await page.locator('.sc-lookcard-bookmark').first().click();
    await page.getByRole('tab', { name: /Bookmarks/ }).click();
    await expect(page).toHaveURL(/[?&]bookmarked=1/);

    const vertical = page.getByRole('tab').nth(2);
    await vertical.click();
    await expect(page).not.toHaveURL(/[?&]bookmarked=1/);
    await expect(page).toHaveURL(/[?&]vertical=/);
    await expect(page.locator('.sc-coll').first()).toBeVisible();
  });

  test('the brand marks are on the attach panel All view, and a dropped mark flags its chip', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.evaluate(async (id) => {
      const png = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
        (c) => c.charCodeAt(0),
      );
      const fd = new FormData();
      fd.append('file', new Blob([png], { type: 'image/png' }), 'logo.png');
      await fetch(`/api/brands/${id}/logos`, { method: 'POST', body: fd });
    }, brand.id);

    await page.goto(`/${brand.slug}/create?compose=1`);
    await page.locator('.sc-attach-toggle').first().click();
    // On the default All view, not only behind the Brand tab: the group is
    // there with the mark in it. ("Brand colors" is a different group, so the
    // anchor is the mark card's own label.)
    const brandGroup = page.locator('.sc-ap-group', { hasText: 'E2E Fixture logo' });
    await expect(brandGroup).toBeVisible();
    await brandGroup.locator('.sc-ap-card', { hasText: 'E2E Fixture logo' }).click();

    // The demo engine reads no references, and the chip says so instead of
    // silently riding along as decoration that never arrives. Plain words
    // with a remedy — the "rides as text only" transport chatter is gone.
    const markChip = page.locator('.sc-brief-line .sc-token[data-kind="mark"]');
    await expect(markChip).toHaveCount(1);
    await expect(markChip).toHaveAttribute('data-warn', '1');
    await expect(markChip).toHaveAttribute('title', /won't reach .* Choose an engine that reads images/);

    // The chip is the whole story now: no card-level transport sentence.
    await expect(page.locator('.sc-reshape-hint[data-kind="dropped-refs"]')).toHaveCount(0);
  });
});

test.describe('one brand stays one brand', () => {
  test('selecting the brand you are already in changes nothing', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.locator('.sc-org-btn').click();
    const row = page.locator('.sc-menu-item[data-current]');
    await expect(row).toContainText('E2E Fixture');
    await expect(row.locator('.sc-menu-check')).toBeVisible();

    const before = page.url();
    await row.click();
    // the menu closes, and that is the entire event
    await expect(page.locator('.sc-menu-item')).toHaveCount(0);
    expect(page.url()).toBe(before);
    expect((await api(page, '/api/brands')) as any[]).toHaveLength(1);
    expect(((await api(page, '/api/brands')) as any[])[0].slug).toBe(brand.slug);
  });

  test('setup warns before minting a duplicate, and creating anyway stays one deliberate click', async ({ page }) => {
    const brand = await currentBrand(page);

    // Sloppy spelling of the existing name still counts as the same brand.
    await page.goto('/setup');
    await page.getByRole('button', { name: 'Start from scratch instead' }).click();
    await page.locator('#sc-wiz-name').fill('e2e  FIXTURE');
    await page.getByRole('button', { name: 'Create it' }).click();
    await expect(page.getByText('You already have')).toBeVisible();
    await page.getByRole('button', { name: 'Open E2E Fixture instead' }).click();
    await page.waitForURL((u) => u.pathname === `/${brand.slug}`);
    expect((await api(page, '/api/brands')) as any[]).toHaveLength(1);

    // The warned path is a speed bump, not a wall.
    await page.goto('/setup');
    await page.getByRole('button', { name: 'Start from scratch instead' }).click();
    await page.locator('#sc-wiz-name').fill('E2E Fixture');
    await page.getByRole('button', { name: 'Create it' }).click();
    await page.getByRole('button', { name: 'Create anyway' }).click();
    await page.waitForURL((u) => u.pathname === `/${brand.slug}-2`);
    expect((await api(page, '/api/brands')) as any[]).toHaveLength(2);

    // Two brands, one display name: the menu tells them apart by slug.
    await page.locator('.sc-org-btn').click();
    await expect(page.locator('.sc-menu-item[data-two-line]')).toHaveCount(2);
    await expect(page.locator('.sc-menu-brand-sub').first()).toContainText(brand.slug);
  });
});

test.describe('the composer attaches your own logo', () => {
  test('the Brand tab mints a kit mark from a file and drops the chip in', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/create`);
    const dock = page.locator('.sc-canvas-dock').first();
    await dock.locator('.sc-attach-toggle').click();
    await page.locator('.sc-ap-tabs button', { hasText: 'Brand' }).click();

    // the tile is the declared-intent channel: a dragged logo stays a plain
    // reference, this is the one gesture that says "this is my logo"
    const tile = page.locator('label.sc-ap-add');
    await expect(tile).toBeVisible();
    await tile.locator('input[type="file"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      ),
    });

    // the chip lands in the sentence without another click
    await expect(page.locator('.sc-brief-line .sc-token')).toHaveCount(1);

    // and the kit really holds it: first mark of an empty kit becomes THE logo
    const logos = await page.evaluate(async (id) => {
      const brands = await (await fetch('/api/brands')).json();
      return brands.find((b: any) => b.id === id).json.logos ?? [];
    }, brand.id);
    expect(logos).toHaveLength(1);
    expect(logos[0].role).toBe('primary');

    // the brief the chip describes really ships the mark, on an engine that reads refs
    const hash = String(logos[0].file).slice(6);
    const preview = (await api(page, '/api/brief/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        brandId: brand.id,
        engineId: 'codex-cli',
        brief: {
          tokens: [
            { t: 'text', v: 'a mug' },
            { t: 'mark', imageHash: hash },
          ],
        },
      }),
    })) as { attachments: { role: string }[] };
    expect(preview.attachments.map((a) => a.role)).toContain('brand');
  });
});
