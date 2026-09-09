import zlib from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The conversation in motion, watched rather than assumed.
 *
 * A sampler in the page reads every turn sixteen milliseconds apart and
 * writes down what happened to it: mounted, thought (dots), started its
 * words, finished them, showed its controls, was picked, left, unmounted.
 * The flows below drive creation and the editor end to end on the demo
 * engine, through every door, every revert, small talk at every question,
 * and at the end the record is held to the rules the transcript promises:
 *
 * - a new line from Scenri thinks first, then its words, then its controls
 *   and its hint; nothing of it shows under the dots
 * - an answer arrives, it is never simply there
 * - a turn that goes fades or keeps its ghost; it is never cut, except when
 *   the setup folds
 * - one line thinks at a time
 * - nothing flickers: a turn that unmounts does not come straight back
 *
 * Reduced motion is the one setting where all of that is off, and the last
 * test holds it to that.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });

const log = (p: Page) => p.getByRole('log');
const composer = (p: Page) => p.locator('.sc-convo-card textarea');
const answer = (p: Page, label: string) => log(p).getByRole('button', { name: label, exact: true });
const send = async (p: Page, text: string) => {
  await composer(p).fill(text);
  await composer(p).press('Enter');
};
const pencil = (p: Page, bubble: string) =>
  log(p).locator('.sc-convo-turn', { hasText: bubble }).getByRole('button', { name: 'Change this answer' });

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

/** A 4 by 5 PNG of one colour, so two photos are two different pictures. */
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

interface Ev {
  t: number;
  id: number;
  turn: string;
  who: string;
  text: string;
  ev: string;
  op?: number;
  leave?: boolean;
  picked?: boolean;
  folded?: boolean;
  arrive?: boolean;
  start?: string;
}

/** Start watching the transcript. Everything already on screen is taken as read. */
async function watch(p: Page) {
  await p.evaluate(() => {
    const M = {
      events: [] as Ev[],
      ids: new WeakMap<Element, number>(),
      n: 0,
      t0: performance.now(),
      last: new Map<number, Record<string, unknown>>(),
      initial: new Set<number>(),
      timer: 0,
      wasFolded: false,
      unfolded: false,
      lastTick: 0,
      maxGap: 0,
    };
    (window as unknown as { __motion: typeof M }).__motion = M;
    const box = document.querySelector('[role="log"]') as HTMLElement;
    const idOf = (el: Element) => {
      if (!M.ids.has(el)) M.ids.set(el, ++M.n);
      return M.ids.get(el) as number;
    };
    const op = (el: Element | null) => (el ? Number(getComputedStyle(el).opacity) : null);
    const push = (e: Partial<Ev> & { id: number; ev: string; turn: string; who: string; text: string }) =>
      M.events.push({ t: Math.round(performance.now() - M.t0), ...e } as Ev);
    let first = true;
    const snap = () => {
      const tick = performance.now();
      if (M.lastTick) M.maxGap = Math.max(M.maxGap, tick - M.lastTick);
      M.lastTick = tick;
      const seenNow = new Set<number>();
      for (const el of box.querySelectorAll('.sc-convo-turn')) {
        const id = idOf(el);
        seenNow.add(id);
        const who = (el as HTMLElement).dataset.who ?? '';
        const turn = (el as HTMLElement).dataset.turn ?? '';
        const text = (el.querySelector('.sc-convo-say, .sc-convo-bubble')?.textContent ?? '').trim().slice(0, 40);
        const dots = el.querySelector('.sc-convo-dots');
        const ws = el.querySelectorAll('.sc-convo-w');
        const q = el.querySelector('.sc-convo-q');
        const shown = getComputedStyle(el).visibility === 'visible';
        const s = {
          op: shown ? (op(el) ?? 1) : 0,
          dots: !!dots && shown && getComputedStyle(dots).visibility === 'visible' && (op(el) ?? 0) > 0.05,
          w1: ws[0] ? op(ws[0]) : null,
          wN: ws.length ? op(ws[ws.length - 1]) : null,
          ctl: q?.firstElementChild ? op(q.firstElementChild) : null,
          hint: op(el.querySelector('.sc-convo-hint')),
          leave: el.hasAttribute('data-leave'),
          picked: !!el.querySelector('.sc-convo-q[data-picked]'),
          folded: !!box.querySelector('.sc-convo-summary'),
        };
        const prev = M.last.get(id) as typeof s | undefined;
        if (!prev) {
          if (first) M.initial.add(id);
          push({
            id,
            turn,
            who,
            text,
            ev: 'mount',
            op: s.op,
            folded: M.unfolded || M.wasFolded !== s.folded,
            // what the app decided about this line's arrival, so a missing beat
            // says whether it was never played or merely not caught
            arrive: (el as HTMLElement).dataset.arrive === 'true',
            start: (el as HTMLElement).style.getPropertyValue('--sc-convo-start'),
          });
        } else {
          if (!prev.dots && s.dots) push({ id, turn, who, text, ev: 'dots on' });
          if (prev.dots && !s.dots) push({ id, turn, who, text, ev: 'dots off' });
          if ((prev.w1 ?? 0) === 0 && (s.w1 ?? 0) > 0) push({ id, turn, who, text, ev: 'words start' });
          if ((prev.wN ?? 0) < 1 && s.wN === 1) push({ id, turn, who, text, ev: 'words done' });
          if (prev.w1 !== null && s.w1 === null) push({ id, turn, who, text, ev: 'words plain' });
          if ((prev.ctl ?? 0) < 0.5 && (s.ctl ?? 0) >= 0.5) push({ id, turn, who, text, ev: 'controls on' });
          if ((prev.hint ?? 0) < 0.5 && (s.hint ?? 0) >= 0.5) push({ id, turn, who, text, ev: 'hint on' });
          if (!prev.leave && s.leave) push({ id, turn, who, text, ev: 'leave' });
          if (!(prev as { shown?: boolean }).shown && s.op > 0.5) push({ id, turn, who, text, ev: 'seen' });
          if (!prev.picked && s.picked) push({ id, turn, who, text, ev: 'picked' });
        }
        // something of the line showing while it is still thinking
        if (s.dots && s.op > 0.5 && ((s.hint ?? 0) > 0.5 || (s.ctl ?? 0) > 0.5)) {
          if (!prev || !(prev as { under?: boolean }).under) push({ id, turn, who, text, ev: 'under dots' });
          (s as { under?: boolean }).under = true;
        } else if (prev && (prev as { under?: boolean }).under) (s as { under?: boolean }).under = true;
        M.last.set(id, {
          ...s,
          text,
          who,
          turn,
          shown: (prev as { shown?: boolean } | undefined)?.shown || s.op > 0.5,
        });
      }
      // the setup folding into its summary, or unfolding from it, moves turns without motion by design
      const foldedNow = !!box.querySelector('.sc-convo-summary');
      for (const [id, prev] of M.last) {
        if (seenNow.has(id)) continue;
        push({
          id,
          turn: String(prev.turn),
          who: String(prev.who),
          text: String(prev.text),
          ev: 'unmount',
          leave: !!prev.leave,
          picked: !!prev.picked,
          folded: foldedNow && !prev.folded,
        });
        M.last.delete(id);
      }
      M.unfolded = M.wasFolded && !foldedNow;
      M.wasFolded = foldedNow;
      first = false;
    };
    snap();
    M.timer = window.setInterval(snap, 16);
  });
}

async function record(p: Page): Promise<{ events: Ev[]; initial: number[]; maxGap: number; end: number }> {
  return p.evaluate(() => {
    const M = (
      window as unknown as {
        __motion: { events: Ev[]; initial: Set<number>; timer: number; maxGap: number; t0: number };
      }
    ).__motion;
    window.clearInterval(M.timer);
    // when the watching stopped, so a line whose beat was still to come is not
    // judged for a beat nobody stayed to see
    return {
      events: M.events,
      initial: [...M.initial],
      maxGap: Math.round(M.maxGap),
      end: Math.round(performance.now() - M.t0),
    };
  });
}

/** What the record says against the rules. */
function judge(
  events: Ev[],
  initial: number[],
  opts: { reduced?: boolean; maxGap?: number; end?: number } = {},
): string[] {
  const out: string[] = [];
  // a sampler starved by a loaded machine misses a dots window; timing rules then say nothing
  const timed = (opts.maxGap ?? 0) < 250;
  const first = new Set(initial);
  const byId = new Map<number, Ev[]>();
  for (const e of events) byId.set(e.id, [...(byId.get(e.id) ?? []), e]);
  const at = (g: Ev[], ev: string) => g.find((e) => e.ev === ev)?.t;
  for (const [id, g] of byId) {
    const m = g[0];
    if (m.ev !== 'mount' || first.has(id)) continue;
    const label = `${m.turn || m.who} "${m.text}"`;
    const record = m.turn.startsWith('scenri:asked-');
    const un = g.find((e) => e.ev === 'unmount');
    if (opts.reduced) {
      if (g.some((e) => e.ev === 'dots on' || e.ev === 'leave' || e.ev === 'picked'))
        out.push(`${label}: motion under reduced motion`);
      continue;
    }
    if (m.who === 'scenri' && !record) {
      const dotsOn = at(g, 'dots on');
      const dotsOff = at(g, 'dots off');
      const wordsStart = at(g, 'words start');
      const wordsDone = at(g, 'words done') ?? at(g, 'words plain');
      // a line replaced before anyone could see it owes no thought
      const lived = (un?.t ?? opts.end ?? Number.POSITIVE_INFINITY) - m.t;
      const shown = g.some((e) => e.ev === 'seen');
      // The beat has two clocks: the line fades in on the browser's animation
      // clock and stops thinking on a timer. A starved page can start the fade
      // hundreds of milliseconds late, which eats the beat without anything
      // being wrong with it, so a line whose fade started far behind its own
      // slot is not held to the rule.
      const slot = Number.parseFloat(m.start ?? '0') || 0;
      const late = (at(g, 'seen') ?? 0) - m.t - slot;
      const onTime = late < 400;
      if (timed && onTime && dotsOn === undefined && shown && lived > 900)
        out.push(
          `${label}: arrived without thinking (arrive=${m.arrive}, start=${m.start || '0'}, late=${Math.round(late)}ms)`,
        );
      if (timed && wordsStart !== undefined && dotsOff !== undefined && wordsStart < dotsOff - 20)
        out.push(`${label}: words before the dots left (${wordsStart} < ${dotsOff})`);
      const ctl = at(g, 'controls on');
      if (ctl !== undefined && wordsDone !== undefined && ctl < wordsDone - 40)
        out.push(`${label}: controls before the words were done (${ctl} < ${wordsDone})`);
      const hint = at(g, 'hint on');
      if (hint !== undefined && wordsDone !== undefined && hint < wordsDone - 40)
        out.push(`${label}: hint before the words were done (${hint} < ${wordsDone})`);
      if (g.some((e) => e.ev === 'under dots')) out.push(`${label}: something shown under the dots`);
    }
    if (m.who === 'you' && (m.op ?? 1) >= 1 && !m.folded) out.push(`${label}: answer simply there, never arrived`);
    if (un && !un.leave && !un.picked && !un.folded) out.push(`${label}: cut, never seen going`);
  }
  // one line thinks at a time
  const thinking = new Set<number>();
  for (const e of events) {
    if (e.ev === 'dots on') {
      if (thinking.size) out.push(`"${e.text}": thinking while ${thinking.size} other line(s) were (${e.t}ms)`);
      thinking.add(e.id);
    }
    if (e.ev === 'dots off' || e.ev === 'unmount') thinking.delete(e.id);
  }
  // nothing flickers (under reduced motion a test moves faster than a person, so it is not held to this)
  const gone = new Map<string, number>();
  if (opts.reduced) return [...new Set(out)];
  for (const e of events) {
    if (e.ev === 'unmount' && e.turn) gone.set(e.turn, e.t);
    if (e.ev === 'mount' && e.turn && gone.has(e.turn)) {
      const left = gone.get(e.turn) ?? 0;
      // A question asked again because the work it was waiting for landed is not
      // a flicker: the world moved on, and other lines arrived while it was away.
      // A flicker is the same turn back with nothing having happened between.
      const moved = events.some(
        (x) => (x.ev === 'mount' || x.ev === 'unmount') && x.id !== e.id && x.t > left && x.t < e.t,
      );
      // folding and unfolding the setup replaces the transcript wholesale; that
      // is not a turn coming back, it is the whole stretch being put away
      if (!moved && !e.folded && e.t - left < 400) out.push(`${e.turn}: back ${e.t - left}ms after it left`);
    }
  }
  return [...new Set(out)];
}

/** The record, for reading when something is off. */
function trace(events: Ev[]): string {
  return events
    .map((e) => `${String(e.t).padStart(6)}ms  ${e.ev.padEnd(12)} ${e.turn.padEnd(34)} ${e.text}`)
    .join('\n');
}

async function settle(p: Page, ms = 2400) {
  await p.waitForTimeout(ms);
}

test.describe('the conversation in motion', () => {
  test('doors, reverts, small talk and photos, watched', async ({ page }) => {
    test.setTimeout(120_000);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await expect(log(page)).toContainText('Who are we creating?');
    await settle(page);
    await watch(page);

    await send(page, 'how are you?');
    await expect(log(page)).toContainText('This is where the person is described');
    await settle(page);
    await answer(page, 'Describe someone').click();
    await expect(log(page)).toContainText('Who are we drawing?');
    await settle(page);
    // the look is tapped a step at a time, each step arriving on its own beat
    await log(page).getByRole('button', { name: 'Woman', exact: true }).click();
    await expect(log(page)).toContainText('About what age?');
    await settle(page);
    await log(page).getByRole('button', { name: 'Skip' }).click();
    await expect(log(page)).toContainText('What colour is their hair?');
    await settle(page, 600);
    await send(page, 'bullshit');
    await expect(log(page)).toContainText('That does not describe anyone.');
    await settle(page);
    await pencil(page, 'Describe someone').click();
    await expect(answer(page, 'Add photos')).toBeVisible();
    await settle(page);
    await answer(page, 'Add photos').click();
    await expect(log(page)).toContainText('Add one clear photo of their face.');
    await settle(page);
    await answer(page, 'Describe someone instead').click();
    await expect(answer(page, 'Add photos')).toBeVisible();
    await settle(page);
    await answer(page, 'Add photos').click();
    await expect(log(page)).toContainText('Add one clear photo of their face.');
    await settle(page);
    // photographs: the block re-renders in place, nothing arrives again
    await page.locator('input[type="file"]').setInputFiles([
      { name: 'a.png', mimeType: 'image/png', buffer: png(200, 40, 40) },
      { name: 'b.png', mimeType: 'image/png', buffer: png(40, 200, 40) },
    ]);
    await expect(log(page).locator('.sc-convo-photos-q img')).toHaveCount(2);
    await settle(page, 800);
    await page.getByRole('checkbox').check();
    await settle(page, 400);
    await answer(page, 'Continue').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 20_000 });
    await expect(log(page)).toContainText('what should we call them?', { timeout: 20_000 });
    await settle(page);
    await send(page, 'Noor');
    await expect(log(page)).toContainText('The set is ready', { timeout: 30_000 });
    await settle(page);
    await send(page, '?');
    await expect(log(page)).toContainText('Select a view and say what is wrong');
    await settle(page);
    await answer(page, 'Save as is').click();
    await expect(answer(page, 'Save presenter')).toBeVisible();
    await settle(page);

    const { events, initial, maxGap, end } = await record(page);
    const bad = judge(events, initial, { maxGap, end });
    if (bad.length) console.log(trace(events));
    expect(bad).toEqual([]);
  });

  test('a person from a sentence, adjusted, built, refined and saved, watched', async ({ page }) => {
    test.setTimeout(120_000);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await expect(log(page)).toContainText('Who are we creating?');
    await settle(page);
    await watch(page);

    await send(page, 'Late 30s woman, Mediterranean, dark shoulder-length hair, slim, warm and composed');
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 20_000 });
    // the demo engine lands the face before a name can be typed: the decision comes first
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
    await settle(page);
    await send(page, 'hey');
    await expect(log(page)).toContainText('Hi. Say what should change');
    await settle(page);
    await send(page, 'shorter hair');
    await expect(log(page)).toContainText('Adjusted. Use this person, or try again.', { timeout: 20_000 });
    await settle(page);
    await answer(page, 'Try again').click();
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
    await settle(page);
    await answer(page, 'Use this person').click();
    await expect(log(page)).toContainText('The set is ready', { timeout: 30_000 });
    await settle(page);
    await answer(page, 'Add them').click();
    await expect(page.locator('.sc-pstudio-slot')).toHaveCount(6, { timeout: 30_000 });
    await expect(log(page)).toContainText('What should we call them?', { timeout: 30_000 });
    await settle(page);
    await send(page, 'wtf');
    await expect(log(page)).toContainText('That is not a name.');
    await settle(page);
    await send(page, 'Maren');
    await expect(answer(page, 'Save presenter')).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await page.locator('.sc-pstudio-slot[data-view="front"]').click();
    await send(page, 'arms relaxed');
    await expect(page.locator('.sc-pstudio-offer')).toContainText('Redrew the full body.', { timeout: 20_000 });
    await settle(page);
    await page.locator('.sc-pstudio-offer').getByRole('button', { name: 'Keep previous' }).click();
    await settle(page);
    await log(page)
      .getByRole('button', { name: /^Setup:/ })
      .click();
    await settle(page, 600);
    await pencil(page, 'Maren').click();
    await expect(composer(page)).toHaveValue('Maren');
    await settle(page);
    await send(page, 'Maren Vale');
    await expect(log(page)).toContainText('Maren Vale is ready.');
    await settle(page);

    const { events, initial, maxGap, end } = await record(page);
    const bad = judge(events, initial, { maxGap, end });
    if (bad.length) console.log(trace(events));
    expect(bad).toEqual([]);

    await answer(page, 'Save presenter').click();
    await expect(page).toHaveURL(/\/presenters\/up-/, { timeout: 20_000 });
  });

  test('the editor, watched', async ({ page }) => {
    test.setTimeout(120_000);
    const brand = await currentBrand(page);
    // a person to edit, made the quick way
    await page.goto(`/${brand.slug}/presenters/new`);
    await send(page, 'a man in his 40s with a grey beard, broad build, calm');
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
    await send(page, 'Idan');
    await answer(page, 'Use this person').click();
    await expect(answer(page, 'Save as is')).toBeVisible({ timeout: 30_000 });
    await answer(page, 'Save as is').click();
    await answer(page, 'Save presenter').click();
    await expect(page).toHaveURL(/\/presenters\/up-/, { timeout: 20_000 });

    await page.getByRole('link', { name: 'Edit presenter' }).click();
    await expect(log(page)).toContainText('What would you like to change about Idan?');
    await settle(page);
    await watch(page);
    await send(page, 'hello');
    await expect(log(page)).toContainText('Say what should change');
    await settle(page);
    await send(page, 'put him in a red suit in Paris');
    await expect(log(page)).toContainText('Use Create for wardrobe, products and scenes.');
    await settle(page);
    await page.locator('.sc-pstudio-slot[data-view="front"]').click();
    await send(page, 'his face looks wrong with the shorter beard');
    await expect(answer(page, 'The presenter')).toBeVisible();
    await settle(page);
    await answer(page, 'The presenter').click();
    await expect(log(page)).toContainText('Here is Idan with the change', { timeout: 20_000 });
    await settle(page);
    await answer(page, 'Use this').click();
    await expect(log(page)).toContainText('Save changes when you are done.', { timeout: 30_000 });
    await settle(page);

    const { events, initial, maxGap, end } = await record(page);
    const bad = judge(events, initial, { maxGap, end });
    if (bad.length) console.log(trace(events));
    expect(bad).toEqual([]);
  });

  test('reduced motion: nothing moves, everything is simply there', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await expect(log(page)).toContainText('Who are we creating?');
    await watch(page);
    await answer(page, 'Describe someone').click();
    await expect(log(page)).toContainText('Who are we drawing?');
    await pencil(page, 'Describe someone').click();
    await expect(answer(page, 'Add photos')).toBeVisible();
    await send(page, 'hey');
    await expect(log(page)).toContainText('Hi. Describe them in a sentence');
    await settle(page, 800);
    const { events, initial, maxGap, end } = await record(page);
    const bad = judge(events, initial, { reduced: true, maxGap, end });
    if (bad.length) console.log(trace(events));
    expect(bad).toEqual([]);
  });
});
