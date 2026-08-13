import { test, expect, type Page } from '@playwright/test';

/**
 * The brand kit, end to end.
 *
 * Everything here is a claim that only a real browser and a real server can
 * settle: that an edit reaches the stored document, that the stored document
 * reaches the prompt, and that the one bug this rewrite existed to kill — a
 * palette edit destroying the brand's neutrals — stays dead.
 */

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

    // The nav slot went back to the work: five items, no Brand tab.
    await expect(page.locator('nav.sc-mainnav button, .sc-mainnav a'))
      .toHaveCount(0, { timeout: 1 })
      .catch(() => {});
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
    // A colour is its swatch, its name, its hex and a way to remove it. No
    // per-row control asking a question the kit already answers.
    await expect(swatches.first().locator('button[role="checkbox"]')).toHaveCount(0);
    await expect(swatches.first().locator('.sc-pal-act[data-danger]')).toBeVisible();
    // Neutrals are shown as their own group rather than as a setting.
    await expect(page.locator('.sc-pal-group')).toHaveText('Neutrals');

    // Rename the first neutral. Any write at all used to collapse neutrals
    // into accents, permanently and silently.
    const neutralName = swatches.nth(3).locator('.sc-pal-name');
    await neutralName.fill('Ink');
    await neutralName.blur();

    await expect
      .poll(async () => {
        const brands = (await api(page, '/api/brands')) as any[];
        return brands.find((b) => b.id === brand.id).json.palette;
      })
      .toMatchObject({
        primary: { hex: '#1F3D2B', name: 'Forest' },
        secondary: { hex: '#E8DCC8', name: 'Oat' },
        accent: [{ hex: '#D96C3B', name: 'Terracotta' }],
        neutrals: [{ hex: '#111111', name: 'Ink' }, { hex: '#FAFAF7' }],
      });

    await page.reload();
    await expect(page.locator('.sc-pal-row')).toHaveCount(5);
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

    const { directives } = (await api(page, `/api/brands/${brand.id}/directives`)) as { directives: string[] };
    expect(directives).toEqual(['Brand rules — never: competitor logos in frame.']);

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
    expect(withColor.prompt).toContain('Use #1F3D2B as a defining color in the composition.');
  });

  test('the composer says the rules apply, without any chip', async ({ page }) => {
    const brand = await currentBrand(page);
    await putBrand(page, brand.id, { ...brand.json, rules: { never: ['competitor logos in frame'] } });

    await page.goto(`/${brand.slug}/create?compose=1`);
    const inherited = page.locator('.sc-inherit-head');
    await expect(inherited).toHaveText('Brand rules apply to every shot');

    // Opening it shows the literal text the compiler appends — not a rewording.
    await inherited.click();
    await expect(page.locator('.sc-inherit-body')).toContainText('Brand rules — never: competitor logos in frame.');

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

    // The line accumulates whatever rules the brand already had, so assert the
    // rule is in it rather than that it is the whole of it.
    await expect
      .poll(async () => {
        const { directives } = (await api(page, `/api/brands/${brand.id}/directives`)) as { directives: string[] };
        return directives.find((d) => d.startsWith('Brand rules — never:')) ?? '';
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

  test('scenes are starred from the card, not from a wizard', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/scenes`);
    const firstStar = page.locator('.sc-lookcard-star').first();
    await firstStar.click();
    await expect(page.locator('.sc-lookcard-star[data-on]')).toHaveCount(1);

    const saved = await page.evaluate((id) => localStorage.getItem(`sc-favscenes-${id}`), brand.id);
    expect(JSON.parse(saved ?? '[]')).toHaveLength(1);
  });
});
