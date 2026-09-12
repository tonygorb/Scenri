import zlib from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Presenter creation as a conversation, end to end, at its own address:
 * /presenters/new for a fresh start, /presenters/new/:draftId once there
 * is a draft.
 *
 * Scenri asks one thing, the person answers by tapping or typing, and the
 * picture arrives on the stage: who are we creating, the sentence or the
 * photographs, one follow-up at most, the face decided, the set built
 * without a click, the name, Save. The harness runs the demo engine
 * (SCENRI_DEMO_BUILDS) with five reference slots (SCENRI_DEMO_REFS), so
 * every step draws a placeholder instantly, and conditioning is proven
 * through `conditionedOn` on the draft. SCENRI_NO_CODEX keeps the analyzer
 * off, so the photos path files the first photo as the face.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

const studio = (p: Page) => p.locator('.sc-pstudio');
const log = (p: Page) => p.getByRole('log');
const composer = (p: Page) => p.locator('.sc-convo-card textarea');
const send = async (p: Page, text: string) => {
  await composer(p).fill(text);
  await composer(p).press('Enter');
};
const answer = (p: Page, label: string) => log(p).getByRole('button', { name: label, exact: true });
const draftsOf = async (p: Page, brandId: string) =>
  (await (await p.request.get(`/api/brands/${brandId}/presenter-drafts`)).json()) as {
    drafts: { id: string; name: string }[];
  };
const draftOf = async (p: Page, brandId: string, draftId: string) =>
  (await p.request.get(`/api/brands/${brandId}/presenter-drafts/${draftId}`)).json();
/**
 * The draft this page is on, by its own address.
 *
 * The brand's list is oldest first, so `drafts[0]` is whichever draft the
 * first test in this file left behind, and a later test asserting through it
 * was reading somebody else's person.
 */
const here = (p: Page): string => /\/(pd-[a-z0-9]+)/.exec(new URL(p.url()).pathname)?.[1] ?? '';
const personNamed = async (p: Page, brandId: string, name: string) => {
  const brands = await (await p.request.get('/api/brands')).json();
  return (brands.find((b: any) => b.id === brandId).json.characters ?? []).find((c: any) => c.name === name);
};

type View = 'portrait' | 'front' | 'three-quarter' | 'back' | 'left' | 'right';

/** A 4 by 5 PNG of one colour, so two photos with different colours are two different pictures. */
function png(r: number, g: number, b: number): Buffer {
  const w = 4;
  const h = 5;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function settledView(p: Page, brandId: string, draftId: string, view: View, want: string) {
  for (let i = 0; i < 200; i++) {
    const d = await draftOf(p, brandId, draftId);
    if (d.views[view].status === want && !d.activeView) return d;
    await p.waitForTimeout(50);
  }
  throw new Error(`${view} never became ${want}`);
}

/** A draft built through the API, up to a point, so a test can start there. */
async function seedDraft(
  p: Page,
  brandId: string,
  upTo: 'portrait-candidate' | 'portrait-approved' | 'core-approved',
  name = 'Idan',
): Promise<string> {
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (
    await p.request.post(base, { data: { source: 'synthetic', direction: 'a man in his 30s', name } })
  ).json();
  await p.request.post(`${base}/${draft.id}/views/portrait/generate`, { data: {} });
  await settledView(p, brandId, draft.id, 'portrait', 'candidate');
  if (upTo === 'portrait-candidate') return draft.id as string;
  await p.request.post(`${base}/${draft.id}/views/portrait/approve`);
  if (upTo === 'portrait-approved') return draft.id as string;
  // The full body is decided by hand like the face, so it is drawn and then
  // approved; only the views nobody decides may be asked to decide themselves.
  await p.request.post(`${base}/${draft.id}/views/front/generate`, { data: {} });
  await settledView(p, brandId, draft.id, 'front', 'candidate');
  await p.request.post(`${base}/${draft.id}/views/front/approve`);
  await p.request.post(`${base}/${draft.id}/views/three-quarter/generate`, { data: { decide: 'auto' } });
  await settledView(p, brandId, draft.id, 'three-quarter', 'approved');
  return draft.id as string;
}

async function openDraft(p: Page, brand: { slug: string; id: string }, draftId: string) {
  await p.goto(`/${brand.slug}/presenters`);
  await p.evaluate(({ id, brandId }) => sessionStorage.setItem(`scenri:presenter-draft:${brandId}`, id), {
    id: draftId,
    brandId: brand.id,
  });
  await p.goto(`/${brand.slug}/presenters/new`);
}

/** Every request the studio makes to the API between two moments. */
function apiCalls(p: Page): { count: () => number; urls: () => string; reset: () => void } {
  let seen: string[] = [];
  // The bell's own tick (activity and asset builds) runs on its own clock in
  // every brand and is not the conversation asking for anything.
  const bell = /\/(activity|asset-builds)$/;
  p.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (r.url().includes('/api/') && !bell.test(path)) seen.push(`${r.method()} ${path}`);
  });
  return {
    count: () => seen.length,
    urls: () => seen.join(', '),
    reset: () => {
      seen = [];
    },
  };
}

test.describe('a person from scratch', () => {
  test('a sentence at the first question, the face, Use, the set on its own, a name, a save: one person in the library', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await expect(log(page)).toContainText('Who are we making?');
    // the whole sentence is in the log from its first frame, never a character at a time
    await expect(log(page).locator('.sc-convo-say').last()).toHaveText(
      'Who are we making? Describe someone new, or add photos of a real person.',
    );
    await expect(composer(page)).toBeFocused();

    // a typed sentence is the description; no door is asked
    await send(page, 'Late 30s woman, Mediterranean appearance, dark shoulder-length hair, slim build, elegant.');
    // one more question before the draw: what else is always true of them
    await answer(page, 'Nothing else').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
    await expect(answer(page, 'Describe someone')).toHaveCount(0);
    await expect(answer(page, 'Add photos')).toHaveCount(0);
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.sc-pstudio-slot')).toHaveCount(3);

    await answer(page, 'Use this person').click();
    // the full body is the second and last decision: it stands on its own
    // first landing, so there is nothing previous to keep
    await expect(log(page)).toContainText('Here is the full body', { timeout: 30_000 });
    await expect(answer(page, 'Keep previous')).toHaveCount(0);
    await answer(page, 'Use it').click();
    // and the rest of the set builds itself: no Use per view after that
    await expect(log(page)).toContainText('The set is ready', { timeout: 30_000 });
    await expect(
      page.locator('.sc-pstudio-slot[data-state="approved"], .sc-pstudio-slot[data-state="current"]'),
    ).toHaveCount(3);
    await expect(answer(page, 'Use it')).toHaveCount(0);

    await answer(page, 'Save as is').click();
    await expect(log(page)).toContainText('What should we call them?');
    await send(page, 'Maren');
    await expect(log(page)).toContainText('Maren is ready.');
    await answer(page, 'Save presenter').click();

    // a saved presenter is an asset: its own page, and the library holds it
    await expect(page).toHaveURL(/\/presenters\/up-/, { timeout: 40_000 });
    await expect(studio(page)).toHaveCount(0);
    const person = await personNamed(page, brand.id, 'Maren');
    expect(person.source).toBe('synthetic');
    expect(person.shots.map((s: any) => s.angle)).toEqual(['portrait', 'front', 'three-quarter']);
    expect(person.avatar).toBeTruthy();
    expect((await draftsOf(page, brand.id)).drafts).toHaveLength(0);
  });

  test('a step with chips still takes words, and small talk at it is answered by that step', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await expect(log(page)).toContainText('Who are they?');
    // the composer is live in front of a question made of chips: it is the
    // only place a person can say the thing none of the chips is
    const field = page.locator('.sc-convo-composer textarea');
    await expect(field).not.toBeDisabled();
    // small talk is answered by the step that is open, and the step stays open
    await send(page, 'hi');
    await expect(log(page)).toContainText('hi');
    await expect(log(page)).toContainText('Who are they?');
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-who"]')).toHaveCount(0);
    // and a real answer in words is that step's answer, chips or no chips
    await send(page, 'a non-binary person');
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-who"]')).toContainText(/non-binary person/i);
    await expect(log(page)).toContainText('Roughly how old?');
    // the same holds for a detail: the chooser takes a detail said in words
    await log(page).getByRole('button', { name: '30s', exact: true }).click();
    await log(page).getByRole('button', { name: 'Black', exact: true }).click();
    await log(page).getByRole('button', { name: 'Shoulder', exact: true }).click();
    await log(page).getByRole('button', { name: 'Olive', exact: true }).click();
    await log(page).getByRole('button', { name: 'Solid', exact: true }).click();
    await expect(log(page)).toContainText('Anything else that is always true of them?');
    await send(page, 'a chipped front tooth');
    await expect(log(page)).toContainText('Here is the presenter, in full. Ready to draw?');
    await expect(log(page).locator('.sc-convo-brief-text')).toContainText('a chipped front tooth');
  });

  test('the look is tapped one step at a time, and what was tapped is the person', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    // one row, one tap, then the next row: who, age, hair, its length, skin, build
    await expect(log(page)).toContainText('Who are they?');
    await log(page).getByRole('button', { name: 'Woman', exact: true }).click();
    await expect(log(page)).toContainText('Roughly how old?');
    await log(page).getByRole('button', { name: '30s', exact: true }).click();
    await expect(log(page)).toContainText('What colour is their hair?');
    await log(page).getByRole('button', { name: 'Black', exact: true }).click();
    await expect(log(page)).toContainText('And the length?');
    // length and build are shapes rather than words
    await expect(log(page).locator('.sc-convo-plate .sc-look-art').first()).toBeVisible();
    await log(page).getByRole('button', { name: 'Shoulder', exact: true }).click();
    await expect(log(page)).toContainText('And their skin?');
    await log(page).getByRole('button', { name: 'Olive', exact: true }).click();
    await expect(log(page)).toContainText('And their build?');
    // every step is its own exchange: its question, and its answer under it
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-who"]')).toContainText('Woman');
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-length"]')).toContainText('Shoulder');
    await log(page).getByRole('button', { name: 'Solid', exact: true }).click();
    // the rows done, what else is always true of them is asked once
    await expect(log(page)).toContainText('Anything else that is always true of them?');
    await answer(page, 'Nothing else').click();
    // nothing is drawn until the whole person is read back and agreed to: the
    // brief stands apart from the talk, with a way to take a copy of it
    await expect(log(page)).toContainText('Here is the presenter, in full. Ready to draw?');
    await expect(log(page).locator('.sc-convo-brief-text')).toHaveText(
      'A woman in their 30s with shoulder-length black hair, olive skin, a solid build.',
    );
    await expect(log(page).getByRole('button', { name: 'Copy' })).toBeAttached();
    await log(page).getByRole('button', { name: 'Draw the presenter' }).click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
    const tapped = await draftsOf(page, brand.id);
    const first = await draftOf(page, brand.id, tapped.drafts[0].id);
    expect(first.direction).toBe('a woman in their 30s with shoulder-length black hair, olive skin, a solid build');
  });

  test('a colour of your own rides in the chip the app uses for a colour', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await log(page).getByRole('button', { name: 'Woman', exact: true }).click();
    await log(page).getByRole('button', { name: '30s', exact: true }).click();
    await expect(log(page)).toContainText('What colour is their hair?');

    // A colour step carries its colour control in the writing area, with no
    // chip to press first: the field is live in front of the swatches, so a
    // second way in would be a second door to the same room.
    const chip = page.locator('.sc-convo-field .sc-token');
    await expect(chip).toHaveText('Pick a colour');
    await expect(page.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.sc-convo-field textarea')).toBeEnabled();
    await expect(log(page).getByRole('button', { name: 'Describe the colour' })).toHaveCount(0);

    // it opens the app's own picker: a colour of your own, since the
    // colours this step has names for are the row above
    await chip.getByRole('button', { name: 'Pick a colour' }).click();
    await expect(page.locator('.sc-cp')).toBeVisible();
    await page.locator('.sc-cp-hex').fill('#8C3B26');
    await expect(chip).toContainText('Auburn');
    // the row is not answered by the chip: one pending answer, in one place
    await expect(log(page).getByRole('button', { name: 'Auburn', exact: true })).not.toHaveAttribute('data-on', /.*/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sc-cp')).toBeHidden();

    // words typed beside it are words about that colour: the chip is read as
    // the first of them, in the order the two are seen
    await page.locator('.sc-convo-field textarea').fill('with copper ends');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-hair"]')).toContainText(
      'Auburn, with copper ends',
    );
    await expect(log(page)).toContainText('And the length?');
    // the next step is not a colour, so no chip stands in its field
    await expect(page.locator('.sc-convo-field .sc-token')).toHaveCount(0);
  });

  test('what says nothing beside a colour is bounced, and the colour is kept', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await log(page).getByRole('button', { name: 'Woman', exact: true }).click();
    await log(page).getByRole('button', { name: '30s', exact: true }).click();
    const chip = page.locator('.sc-convo-field .sc-token');
    await chip.getByRole('button', { name: 'Pick a colour' }).click();
    // not the colour the wheel opens on, which would be no change at all
    await page.locator('.sc-cp-hex').fill('#D8AC63');
    // the chip paints as the picker moves, so it reads the colour before it closes
    await expect(chip).toContainText('Blonde');
    await page.keyboard.press('Escape');
    await expect(page.locator('.sc-cp')).toBeHidden();
    await page.locator('.sc-convo-field textarea').fill('sdf');
    await page.getByRole('button', { name: 'Send' }).click();
    // the step stays open, answered about hair rather than about the whole
    // person, and the colour stands
    await expect(log(page)).toContainText('sdf');
    await expect(log(page)).toContainText('That is not a hair colour.');
    await expect(log(page)).not.toContainText('presence.');
    await expect(log(page)).toContainText('What colour is their hair?');
    await expect(chip).toContainText('Blonde');
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-hair"]')).toHaveCount(0);

    // the X takes the colour off and the pill goes back to a choice to make
    await chip.getByRole('button', { name: 'Remove colour' }).click();
    await expect(chip).toHaveText('Pick a colour');
    await page.locator('.sc-convo-field textarea').fill('');
    await expect(page.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('an answer open again drops what was held for it, and asks from nothing when it comes round', async ({
    page,
  }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await log(page).getByRole('button', { name: 'Woman', exact: true }).click();
    await log(page).getByRole('button', { name: '30s', exact: true }).click();

    // a colour held in the composer, not yet sent
    const chip = page.locator('.sc-convo-field .sc-token');
    await chip.getByRole('button', { name: 'Pick a colour' }).click();
    await page.locator('.sc-cp-hex').fill('#7F3FBF');
    await page.keyboard.press('Escape');
    await expect(chip).toContainText('Dyed purple');

    // an earlier answer opened again takes the composer back: the held colour goes with it
    await log(page)
      .locator('.sc-convo-turn[data-turn="you:look-age"]')
      .getByRole('button', { name: 'Change this answer' })
      .click();
    await expect(log(page).locator('.sc-convo-turn[data-turn="q:look-age"][data-reopened]')).toHaveCount(1);
    // an answer is being changed, so the composer waits and carries nothing
    await expect(page.locator('.sc-convo-field .sc-token')).toHaveCount(0);
    // the question the conversation is on stands where it is, and takes no answer
    await expect(log(page).locator('.sc-convo-turn[data-turn="q:look-hair"]')).toHaveAttribute('data-dim', 'true');

    // and the step, when it comes round again, asks from nothing
    await log(page).locator('.sc-convo-turn[data-turn="q:look-age"]').getByRole('button', { name: '40s' }).click();
    await expect(log(page)).toContainText('What colour is their hair?');
    // the control is there because the step is, and it holds no colour: what
    // was picked for the run that was taken back did not come with it
    await expect(page.locator('.sc-convo-field .sc-token')).toHaveText('Pick a colour');
    await expect(page.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('an answer opens again where it stands, with the answer lit, and what came after it stays', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await expect(log(page)).toContainText('Who are they?');
    await log(page).getByRole('button', { name: 'Woman', exact: true }).click();
    await expect(log(page)).toContainText('Roughly how old?');
    await log(page).getByRole('button', { name: '30s', exact: true }).click();
    await expect(log(page)).toContainText('What colour is their hair?');
    await log(page).getByRole('button', { name: 'Black', exact: true }).click();
    await expect(log(page)).toContainText('And the length?');

    // the pencil opens that one question again, in its place, with the answer lit
    await log(page)
      .locator('.sc-convo-turn[data-turn="you:look-age"]')
      .getByRole('button', { name: 'Change this answer' })
      .click();
    const reopened = log(page).locator('.sc-convo-turn[data-turn="q:look-age"]');
    await expect(reopened).toHaveAttribute('data-reopened', 'true');
    await expect(reopened.getByRole('button', { name: '30s', exact: true })).toHaveAttribute('data-on', 'true');
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-age"]')).toHaveCount(0);
    // what came before and after it is untouched: the hair does not depend on the age
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-who"]')).toContainText('Woman');
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-hair"]')).toContainText('Black');
    // the question the conversation is on stands, dim, and takes no answer meanwhile
    const standing = log(page).locator('.sc-convo-turn[data-turn="q:look-length"]');
    await expect(standing).toHaveAttribute('data-dim', 'true');
    await expect(standing.getByRole('button', { name: 'Long', exact: true })).toBeDisabled();

    // leaving it as it was changes nothing
    await reopened.getByRole('button', { name: 'Cancel' }).click();
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-age"]')).toContainText('30s');
    await expect(log(page).locator('.sc-convo-turn[data-dim]')).toHaveCount(0);

    // changing it takes back what the conversation asked after it, and asks again from there
    await log(page)
      .locator('.sc-convo-turn[data-turn="you:look-age"]')
      .getByRole('button', { name: 'Change this answer' })
      .click();
    await log(page)
      .locator('.sc-convo-turn[data-turn="q:look-age"]')
      .getByRole('button', { name: '40s', exact: true })
      .click();
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-age"]')).toContainText('40s');
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-who"]')).toContainText('Woman');
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-hair"]')).toHaveCount(0);
    await expect(log(page)).toContainText('What colour is their hair?');
  });

  test('a text answer is rewritten in place, and cancelling changes nothing', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await log(page).getByRole('button', { name: 'Describe them instead' }).click();
    await expect(log(page)).toContainText('Describe them.');
    await send(page, 'a woman in her 30s with dark curls');
    await answer(page, 'Nothing else').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 30_000 });

    // a face is already drawn from the words, so changing them is asked about first
    await log(page)
      .locator('.sc-convo-turn', { hasText: 'dark curls' })
      .getByRole('button', { name: 'Change this answer' })
      .click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Change it' }).click();
    // cancelling leaves the answer exactly as it was
    const field = log(page).locator('.sc-convo-rewrite');
    await expect(field).toHaveValue('a woman in her 30s with dark curls');
    await field.fill('something else entirely');
    await log(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(log(page).locator('.sc-convo-rewrite')).toHaveCount(0);
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:describe"]')).toContainText('dark curls');

    // saying it again replaces it, and it is what the drawing is asked for
    await log(page)
      .locator('.sc-convo-turn', { hasText: 'dark curls' })
      .getByRole('button', { name: 'Change this answer' })
      .click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Change it' }).click();
    await log(page).locator('.sc-convo-rewrite').fill('a man in his 50s with a shaved head');
    await log(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:describe"]')).toContainText('shaved head');
    // the run carries on from the change; the words reach the draft once it is whole
    await answer(page, 'Nothing else').click();
    await expect
      .poll(async () => (await draftOf(page, brand.id, here(page))).direction, { timeout: 20_000 })
      .toBe('a man in his 50s with a shaved head');
  });

  test('a thin sentence asks one follow-up, and its picks fold into the sentence', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await expect(log(page)).toContainText('Who are they?');
    // the steps own the answer; saying it in words is asked for
    await log(page).getByRole('button', { name: 'Describe them instead' }).click();
    await expect(log(page)).toContainText('Describe them.');
    await send(page, 'black curly hair');
    await expect(log(page)).toContainText('cannot tell yet');
    await page.getByRole('radio', { name: 'Man', exact: true }).click();
    await page.getByRole('radio', { name: '20s' }).click();
    await page.getByRole('radio', { name: 'Athletic' }).click();
    await answer(page, 'Continue').click();
    await answer(page, 'Nothing else').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
    const d = await draftOf(page, brand.id, here(page));
    expect(d.direction).toBe('a man in his 20s, black curly hair, athletic build');
    // the follow-up was asked once and is answered in the record
    await expect(log(page)).toContainText('Man, 20s, Athletic');
    // the question stays in the record as Scenri's line; its controls are gone
    await expect(log(page).getByRole('radio')).toHaveCount(0);
  });

  test('deterministic turns cost no request, and the words are whole for a screen reader', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await expect(answer(page, 'Describe someone')).toBeVisible();
    const calls = apiCalls(page);
    await page.waitForTimeout(300);
    calls.reset();
    await answer(page, 'Describe someone').click();
    await expect(log(page)).toContainText('Who are they?');
    await page.waitForTimeout(900);
    expect(calls.urls()).toBe('');
    // one sentence, one node's text, from the first frame
    await expect(log(page).locator('.sc-convo-say').last()).toHaveText('Who are they?');
  });

  test('reduced motion: no arrival plays, the line simply stands', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await expect(log(page)).toContainText('Who are they?');
    await expect(page.locator('[data-reveal] .sc-convo-w')).toHaveCount(0);
  });

  test('leaving before anything is drawn asks, and what it forgets is really forgotten', async ({ page }) => {
    const brand = await currentBrand(page);
    // the file shares one library, so what matters is that these answers add nothing
    const before = (await draftsOf(page, brand.id)).drafts.length;
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await answer(page, 'Woman').click();
    await expect(log(page)).toContainText('Roughly how old?');

    // Escape with answers and nothing drawn: the flow asks before it costs anything
    await page.keyboard.press('Escape');
    const asked = page.getByRole('alertdialog').filter({ hasText: 'Leave without drawing them?' });
    await expect(asked).toBeVisible();
    await asked.getByRole('button', { name: 'Cancel' }).click();
    await expect(studio(page)).toBeVisible();
    await expect(log(page)).toContainText('Roughly how old?');

    // agreed: the flow closes and the answers go with it. The dialog is asked
    // for again from scratch, so the one that was dismissed has to be gone
    // before the new one is clicked, or the click lands on a leaving node.
    await expect(asked).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(asked).toBeVisible();
    await asked.getByRole('button', { name: 'Leave' }).click();
    await expect(studio(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters$`));
    expect((await draftsOf(page, brand.id)).drafts).toHaveLength(before);

    // and the next one starts at the first question, with nothing behind it
    await page.goto(`/${brand.slug}/presenters/new`);
    await expect(answer(page, 'Describe someone')).toBeVisible();
    await expect(log(page)).not.toContainText('Roughly how old?');
  });

  test('a draft has an address: reload keeps the step, close keeps the draft, reopen resumes it', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-candidate');
    await openDraft(page, brand, draftId);
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new/${draftId}$`));
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
    // the transcript is rebuilt from the draft: the sentence and the name are there, no door is asked
    await expect(log(page)).toContainText('a man in his 30s');
    await expect(answer(page, 'Describe someone')).toHaveCount(0);

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new/${draftId}$`));
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });

    await page.keyboard.press('Escape');
    await expect(studio(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters$`));
    expect((await draftsOf(page, brand.id)).drafts.map((d) => d.id)).toContain(draftId);

    await page.goto(`/${brand.slug}/presenters/new`);
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
  });

  test('Try again keeps nothing of the candidate; an adjustment keeps the person', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-candidate');
    await openDraft(page, brand, draftId);
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
    const before = await draftOf(page, brand.id, draftId);
    await send(page, 'a little older');
    await expect(log(page)).toContainText('Adjusted. Use this person, or try again.', { timeout: 20_000 });
    const after = await draftOf(page, brand.id, draftId);
    expect(after.views.portrait.attempts).toBe(before.views.portrait.attempts + 1);
    expect(after.views.portrait.conditionedOn).toContain(before.views.portrait.hash);
    await answer(page, 'Try again').click();
    await expect
      .poll(async () => (await draftOf(page, brand.id, draftId)).views.portrait.attempts)
      .toBe(after.views.portrait.attempts + 1);
  });

  test('the name is asked once and changed from its pencil without touching a picture', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'core-approved', '');
    await openDraft(page, brand, draftId);
    await answer(page, 'Save as is').click();
    await expect(log(page)).toContainText('What should we call them?');
    await send(page, 'Marren');
    await expect(log(page)).toContainText('Marren is ready.');
    const before = await draftOf(page, brand.id, draftId);
    await log(page)
      .locator('.sc-convo-turn', { hasText: 'Marren' })
      .getByRole('button', { name: 'Change this answer' })
      .click();
    // the answer itself becomes the field, with the words already in it
    const rewrite = log(page).locator('.sc-convo-rewrite');
    await expect(rewrite).toHaveValue('Marren');
    await rewrite.fill('Maren');
    await log(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(log(page)).toContainText('Maren is ready.');
    const after = await draftOf(page, brand.id, draftId);
    expect(after.name).toBe('Maren');
    expect(after.generations).toBe(before.generations);
    expect(after.views.portrait.hash).toBe(before.views.portrait.hash);
  });

  test('a new description after the face asks first, then redraws the face from it', async ({ page }) => {
    test.setTimeout(60_000);
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-candidate');
    await openDraft(page, brand, draftId);
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
    await log(page)
      .locator('.sc-convo-turn', { hasText: 'a man in his 30s' })
      .getByRole('button', { name: 'Change this answer' })
      .click();
    // asked first: the face was drawn from the old words
    await page.getByRole('alertdialog').getByRole('button', { name: 'Change it' }).click();
    const said = log(page).locator('.sc-convo-rewrite');
    await expect(said).toHaveValue('a man in his 30s');
    await said.fill('a woman in her 50s with silver hair');
    await log(page).getByRole('button', { name: 'Save', exact: true }).click();
    // the run carries on from the change; the words reach the draft once it is whole
    await answer(page, 'Nothing else').click();
    await expect
      .poll(async () => (await draftOf(page, brand.id, draftId)).direction, { timeout: 20_000 })
      .toBe('a woman in her 50s with silver hair');
    // the face is drawn again from the new sentence, and decided again
    await expect
      .poll(async () => (await draftOf(page, brand.id, draftId)).views.portrait.attempts, { timeout: 20_000 })
      .toBe(2);
    // the face it replaced is kept rather than thrown away, so the new one is
    // offered as a revision: asking for another picture cannot cost you the
    // one you had, and a draw that never lands puts it back
    await expect(answer(page, 'Use this')).toBeVisible({ timeout: 20_000 });
    await expect(answer(page, 'Keep previous')).toBeVisible();
  });

  test('after the lock, a sentence about the person redraws the face and Use redraws the views built on it', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'core-approved');
    await openDraft(page, brand, draftId);
    await expect(answer(page, 'Save as is')).toBeVisible({ timeout: 20_000 });
    const before = await draftOf(page, brand.id, draftId);
    await send(page, 'shorter hair');
    // while it draws, the stage says so over the picture it is redrawing
    await expect(page.locator('.sc-pstudio-doing')).toContainText('Adjusting the face');
    await expect(page.locator('.sc-pstudio-veil')).toHaveCount(1);
    await expect(log(page)).toContainText('with the change', { timeout: 20_000 });
    await expect(page.locator('.sc-pstudio-doing')).toHaveCount(0);
    await expect(page.locator('.sc-pstudio-compare')).toBeVisible();
    const revised = await draftOf(page, brand.id, draftId);
    expect(revised.views.portrait.status).toBe('candidate');
    expect(revised.views.portrait.prior).toBe(before.views.portrait.hash);
    await answer(page, 'Use this').click();
    // the full body is rebuilt from the new face and asks, as it always does.
    // Nothing is offered back: the picture it replaces was drawn from the old
    // face, so there is no previous full body worth keeping.
    await expect(log(page)).toContainText('Here is the full body', { timeout: 30_000 });
    await expect(answer(page, 'Keep previous')).toHaveCount(0);
    await answer(page, 'Use it').click();
    // the rest goes stale and rebuilds on its own, conditioned on the new face
    await expect(answer(page, 'Save as is')).toBeVisible({ timeout: 30_000 });
    const after = await draftOf(page, brand.id, draftId);
    expect(after.views.portrait.hash).toBe(revised.views.portrait.hash);
    // the demo engine draws the same bytes for the same words, so the proof is the conditioning and the count
    expect(after.views.front.attempts).toBe(before.views.front.attempts + 1);
    expect(after.views.front.conditionedOn).toContain(after.views.portrait.hash);
    expect(after.views['three-quarter'].status).toBe('approved');
  });

  test('a sentence about the view on the stage changes that view only, and Keep previous takes it back', async ({
    page,
  }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'core-approved');
    await openDraft(page, brand, draftId);
    await expect(answer(page, 'Save as is')).toBeVisible({ timeout: 20_000 });
    const before = await draftOf(page, brand.id, draftId);
    await page.locator('.sc-pstudio-slot[data-view="front"]').click();
    await expect(page.locator('.sc-convo-scope')).toHaveText('Refining the full body');
    await send(page, 'turn slightly more to camera');
    await expect(log(page)).toContainText('Redrew the full body. Use it, or keep the previous one.', {
      timeout: 20_000,
    });
    const redrawn = await draftOf(page, brand.id, draftId);
    expect(redrawn.views.front.status).toBe('candidate');
    expect(redrawn.views.front.prior).toBe(before.views.front.hash);
    expect(redrawn.views.portrait.hash).toBe(before.views.portrait.hash);
    expect(redrawn.views['three-quarter'].hash).toBe(before.views['three-quarter'].hash);
    await answer(page, 'Keep previous').click();
    await expect
      .poll(async () => (await draftOf(page, brand.id, draftId)).views.front.hash)
      .toBe(before.views.front.hash);
    await expect(answer(page, 'Keep previous')).toHaveCount(0);
    // every picture drawn for a view keeps its own card, numbered, and the one
    // on the stage says so; the other is the press that puts it back
    await expect(log(page)).toContainText('Keep previous');
    const pictures = () =>
      log(page)
        .getByText(/^Here is full body \d+\.$/)
        .count();
    expect(await pictures()).toBe(2);
    // the picture the view wears is marked and says so
    await expect(log(page).locator('.sc-convo-shot[data-current] img')).toHaveAttribute('alt', 'Full body 1, active');
    // and neither picture can be put in the other's place from here. The
    // three-quarter was drawn from this view, so swapping it stales that too:
    // offered as a press or an arrow, it is a demolition sold as an undo. The
    // swap lives where nothing is standing on the picture yet.
    await expect(log(page).locator('.sc-convo-restore')).toHaveCount(0);
    await expect(page.locator('.sc-pstudio-vers')).toHaveCount(0);
  });

  test('the pictures of a view are stepped through while nothing is built on it', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-candidate');
    await openDraft(page, brand, draftId);
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
    const first = (await draftOf(page, brand.id, draftId)).views.portrait.hash;
    await send(page, 'make the hair shorter');
    await expect(log(page)).toContainText('Adjusted.', { timeout: 20_000 });
    // two faces and nothing drawn from either, so both ways back are offered
    // and neither of them costs a generation
    const calls = apiCalls(page);
    const vers = page.locator('.sc-pstudio-vers');
    await expect(vers).toContainText('Version 2 of 2');
    await page.getByRole('button', { name: 'The version before' }).click();
    await expect(vers).toContainText('Version 1 of 2');
    const restore = log(page).locator('.sc-convo-restore');
    await expect(restore).toHaveCount(1);
    await restore.click();
    await expect
      .poll(async () => (await draftOf(page, brand.id, draftId)).views.portrait.hash, { timeout: 20_000 })
      .toBe(first);
    expect(calls.urls()).not.toContain('/generate');
  });

  test('an unfinished person is offered back from the library, and can be let go', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-candidate', 'Halden');
    await page.goto(`/${brand.slug}/presenters`);
    // the wall carries them first, marked, with how far along they are: the
    // work used to be reachable only from the tab it was started in
    const card = page.locator(`.sc-lookcard[data-build]:has(a[href$="/presenters/new/${draftId}"])`);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Draft');
    await expect(card).toContainText('Halden');
    await expect(card).toContainText('A face to decide');

    // and opening one resumes the conversation where it was left, without
    // spending anything or writing over what the draft holds
    const before = await draftOf(page, brand.id, draftId);
    await card.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/presenters/new/${draftId}$`));
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
    const after = await draftOf(page, brand.id, draftId);
    expect(after.generations).toBe(before.generations);
    expect(after.views.portrait.hash).toBe(before.views.portrait.hash);

    // letting it go takes it off the wall
    await page.goto(`/${brand.slug}/presenters`);
    await card.getByRole('button', { name: /Discard/ }).click();
    await expect(card).toHaveCount(0);
  });

  test('Add them builds the back and profile views, and the strip grows to six', async ({ page }) => {
    test.setTimeout(60_000);
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'core-approved');
    await openDraft(page, brand, draftId);
    await answer(page, 'Add them').click();
    await expect(page.locator('.sc-pstudio-slot')).toHaveCount(6);
    await expect(log(page)).toContainText('Idan is ready.', { timeout: 40_000 });
    const d = await draftOf(page, brand.id, draftId);
    expect(['back', 'left', 'right'].every((v) => d.views[v].status === 'approved')).toBe(true);
  });

  test('Start over asks, then leaves nothing behind and keeps the sentence', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-approved');
    await openDraft(page, brand, draftId);
    await expect(page.getByRole('button', { name: 'Start over', exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Start over', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new$`));
    await expect(answer(page, 'Describe someone')).toBeVisible();
    await expect(composer(page)).toHaveValue('a man in his 30s');
    expect((await page.request.get(`/api/brands/${brand.id}/presenter-drafts/${draftId}`)).status()).toBe(404);
  });

  test('a failed draw offers Retry and keeps the rest of the person', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-approved');
    let blocked = true;
    await page.route(`**/presenter-drafts/${draftId}/views/front/generate`, async (route) => {
      if (blocked && route.request().method() === 'POST') {
        blocked = false;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'the engine fell over' }),
        });
        return;
      }
      await route.continue();
    });
    await openDraft(page, brand, draftId);
    await expect(answer(page, 'Retry')).toBeVisible({ timeout: 20_000 });
    await expect(log(page)).toContainText('Nothing finished was touched.');
    await answer(page, 'Retry').click();
    await expect(log(page)).toContainText('Here is the full body', { timeout: 30_000 });
    await answer(page, 'Use it').click();
    await expect(log(page)).toContainText('The set is ready', { timeout: 30_000 });
    const d = await draftOf(page, brand.id, draftId);
    expect(d.views.portrait.status).toBe('approved');
    expect(d.views.front.status).toBe('approved');
  });
});

test.describe('from photos', () => {
  test('one photo: the photo is the face, the rest is drawn from it, and the record keeps the originals', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Add photos').click();
    await expect(log(page)).toContainText('Add one clear photo of their face.');
    const cont = answer(page, 'Continue');
    await expect(cont).toHaveAttribute('aria-disabled', 'true');
    await page.locator('input[type="file"]').setInputFiles({ name: 'noor.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.sc-assetform-ref')).toHaveCount(1);
    await expect(cont).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('checkbox').check();
    await expect(cont).not.toHaveAttribute('aria-disabled', 'true');
    await cont.click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
    await expect(log(page)).toContainText('Face from your photo', { timeout: 20_000 });
    // the photographs are asked once what is always true of them, before the set
    await answer(page, 'Nothing to add').click();
    await expect(log(page)).toContainText('Here is the full body', { timeout: 30_000 });
    await answer(page, 'Use it').click();
    await expect(answer(page, 'Save as is')).toBeVisible({ timeout: 30_000 });
    // the photo is never redrawn, and an identity ask against it is refused
    await send(page, 'make her nose smaller');
    await expect(page.locator('.sc-convo-line[role="alert"]')).toContainText('Their photos define who they are.');
    await answer(page, 'Save as is').click();
    await send(page, 'Noor');
    await answer(page, 'Save presenter').click();
    await expect(page).toHaveURL(/\/presenters\/up-/, { timeout: 40_000 });
    const person = await personNamed(page, brand.id, 'Noor');
    expect(person.source).toBe('photos');
    expect(person.sourceRefs).toHaveLength(1);
    expect(person.shots[0].angle).toBe('portrait');
    expect(person.shots[0].file).toBe(person.sourceRefs[0].file);
    expect(person.likeness.version).toBe('v1');
  });

  test('four photos ride, a fifth is refused, and a photo can be taken back before continuing', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Add photos').click();
    // five distinct pictures, so five distinct hashes after the store normalises them
    const files = [1, 2, 3, 4, 5].map((i) => ({
      name: `p${i}.png`,
      mimeType: 'image/png',
      buffer: png(40 * i, 90, 120),
    }));
    await page.locator('input[type="file"]').setInputFiles(files);
    await expect(page.locator('.sc-assetform-ref')).toHaveCount(4);
    await expect(log(page)).toContainText('Four angles.');
    await page.getByRole('button', { name: 'Remove reference 4' }).click();
    await expect(page.locator('.sc-assetform-ref')).toHaveCount(3);
    await expect(log(page)).toContainText('3 photos.');
  });
});

test.describe('the doors', () => {
  test('the chooser hands over to the studio, and one Back returns to where you were', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/products`);
    await page.getByRole('button', { name: 'Add to this brand', exact: true }).click();
    await page.locator('.sc-pick[data-kind="presenter"]').click();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new$`));
    await expect(studio(page)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/products$`));
    await expect(studio(page)).toHaveCount(0);
  });

  test('the old ?new=presenter address forwards to the studio', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters?new=presenter`);
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new$`));
    await expect(studio(page)).toBeVisible();
  });

  test('the library page and the create rail both open the same studio', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters`);
    await page.getByRole('button', { name: 'Create presenter' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new$`));
    await expect(log(page)).toContainText('Who are we making?');
  });

  test('an existing presenter still opens from the library', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters`);
    // the card's own Use button sits over its centre; the link is hit at its corner
    await page.getByRole('link', { name: /white-blonde pixie/ }).click({ position: { x: 8, y: 8 } });
    await expect(page).toHaveURL(/\/presenters\/[^/]+$/);
    await expect(page.getByRole('button', { name: 'Use in a shot' }).first()).toBeVisible();
  });
});

test.describe('what answers nothing', () => {
  test('is answered with the question in words for what was said, makes no draft, and a sentence with nothing of a person in it is asked about first', async ({
    page,
  }) => {
    const brand = await currentBrand(page);
    let drafts = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/presenter-drafts$/.test(r.url())) drafts++;
    });
    await page.goto(`/${brand.slug}/presenters/new`);
    await expect(log(page)).toContainText('Who are we making?');
    await send(page, 'how are you?');
    await expect(log(page)).toContainText('This is where the person is described');
    await send(page, 'bullshit');
    await expect(log(page)).toContainText('That does not describe anyone.');
    await send(page, 'i want to create a presenter');
    await expect(log(page)).toContainText('That is what we are here for.');
    await send(page, 'like Zendaya');
    await expect(log(page)).toContainText('does not draw a named person');
    await send(page, 'start over');
    await expect(log(page)).toContainText('Start over at the top');
    // every one of them is still there, in order, and the doors still stand
    expect(await log(page).locator('.sc-convo-bubble').allTextContents()).toEqual([
      'Create a presenter',
      'how are you?',
      'bullshit',
      'i want to create a presenter',
      'like Zendaya',
      'start over',
    ]);
    await expect(answer(page, 'Describe someone')).toBeVisible();
    // nothing of a person in it: asked about, not drawn
    await send(page, 'a florist from Paris who sells tulips');
    await expect(answer(page, 'Use it anyway')).toBeVisible();
    expect(drafts).toBe(0);
    await answer(page, 'Use it anyway').click();
    await expect(log(page)).toContainText('cannot tell yet');
    await answer(page, 'Skip, draw as is').click();
    await answer(page, 'Nothing else').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
    expect(drafts).toBe(1);
  });

  test('a conversation that was already had is not written out again on a reload', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'core-approved');
    await openDraft(page, brand, draftId);
    await expect(answer(page, 'Save as is')).toBeVisible({ timeout: 20_000 });
    const said = await log(page).locator('.sc-convo-turn').count();
    expect(said).toBeGreaterThan(3);
    // the page is opened again on the same conversation: it is simply there
    await page.reload();
    await expect(log(page).locator('.sc-convo-turn')).toHaveCount(said, { timeout: 20_000 });
    for (let i = 0; i < 12; i++) {
      expect(await log(page).locator('.sc-convo-turn[data-arrive]').count()).toBe(0);
      expect(await log(page).locator('.sc-convo-dots').count()).toBe(0);
      await page.waitForTimeout(150);
    }
    // and what happens after it is written as it happens
    await send(page, 'hey');
    await expect(log(page).locator('.sc-convo-dots').first()).toBeVisible();
  });

  test('a line takes a beat to arrive, and none at all under reduced motion', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await expect(log(page)).toContainText('Who are we making?');
    // a tap is seen before it is taken: the chosen chip lights and the row steps back, then the turn takes its place
    await answer(page, 'Describe someone').click();
    await expect(log(page).locator('.sc-convo-q[data-picked] .sc-convo-choice[data-on]')).toHaveText(
      'Describe someone',
    );
    await expect(log(page)).toContainText('Who are they?');
    await expect(log(page).locator('.sc-convo-q[data-picked]')).toHaveCount(0);
    await log(page).getByRole('button', { name: 'Describe them instead' }).click();
    await send(page, 'hey');
    // the reply arrives with its words: nothing pretends to think about a line
    // it already had
    await expect(log(page)).toContainText('Hi. A few words about them is enough');
    await expect(log(page).locator('.sc-convo-dots')).toHaveCount(0);
    // an answer opened again from its pencil is there at once, where it was: nothing types it out
    await log(page)
      .locator('.sc-convo-turn', { hasText: 'Describe someone' })
      .getByRole('button', { name: 'Change this answer' })
      .click();
    await expect(log(page).locator('.sc-convo-turn[data-turn="q:source"][data-reopened]')).toBeAttached();
    await expect(answer(page, 'Add photos')).toBeVisible();
    await expect(log(page).locator('.sc-convo-dots')).toHaveCount(0);
    // the other door arrives with its beat, and has a way back
    await answer(page, 'Add photos').click();
    await expect(log(page).locator('.sc-convo-dots').first()).toBeVisible();
    await expect(log(page).locator('.sc-convo-dots')).toHaveCount(0, { timeout: 4000 });
    await expect(log(page)).toContainText('Add one clear photo of their face.');
    await expect(answer(page, 'Describe someone instead')).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(log(page)).toContainText('Add one clear photo of their face.');
    await answer(page, 'Describe someone instead').click();
    await expect(log(page)).toContainText('Who are we making?');
    await send(page, 'hello');
    await expect(log(page)).toContainText('Hi. Describe them in a sentence, or pick one above.');
    await expect(log(page).locator('.sc-convo-dots')).toHaveCount(0);
  });
});
