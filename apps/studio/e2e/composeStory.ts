import type { APIRequestContext, Locator, Page, Response } from '@playwright/test';

/**
 * The compose story, walked the way a person walks it: open the brand, write the prompt with each
 * ingredient summoned inline by its sigil, generate, open the shot while it renders, and refine it
 * once in words.
 *
 * One walk, two callers. compose-story.spec.ts walks it plainly on the demo engine, so a change to
 * any surface it crosses fails there first. A film capture outside the repo walks the same steps
 * with a director that paces them for a camera and marks the beats it cuts on. That caller loads
 * this file by path from a plain Node process, which is why it imports types and nothing else.
 */

/** One ingredient, summoned inline: its sigil and the first letters of its name, taken from the caret menu. */
export type Pick = {
  /** `$` a product, `/` a scene, `@` a presenter, `#` a colour. */
  sigil: '$' | '/' | '@' | '#';
  /** What is typed after the sigil. */
  query: string;
  /** The row the menu offers, and the chip's token once it is taken. */
  name: string;
  token: string;
};

/** What the story composes: public demo content only, nothing from anyone's library. */
export type Story = {
  /** The fictional brand the product is sold under, seeded by name. */
  brand: string;
  /**
   * The brand's earlier work: showcase recipes (templates/showcase) remade before the story starts,
   * so Create opens on a feed that has been used rather than an empty one.
   */
  history: string[];
  /** The prompt as a person writes it: words, and ingredients inline. It is the whole direction: nothing else is sent. */
  line: (string | Pick)[];
  /** The one refinement, typed on the open shot. */
  refinement: string;
};

/** The public recipe templates/showcase/barrier-cream-caddy.json, written as one sentence. */
export const barrierCream: Story = {
  brand: 'Fenwick Slade',
  // the product's other shipped recipes; the caddy itself is left out, it is the shot being made
  history: ['barrier-cream-cheek', 'barrier-cream-ice-core', 'barrier-cream-oats'],
  line: [
    { sigil: '$', query: 'barr', name: 'Barrier Cream', token: 'p:fenwick-slade-barrier-cream' },
    ' on the ',
    { sigil: '/', query: 'bath', name: 'Bath Caddy', token: 't:teak-bath-caddy' },
    ', lid off, centred in the hard sun.',
  ],
  refinement: 'Golden hour, long warm shadows',
};

/** The moments the story reaches, in order. A film cuts and frames on them; the spec checks the order. */
export type Beat =
  | 'home'
  | 'line'
  | `menu-${number}`
  | `chip-${number}`
  | 'direction'
  | 'generate'
  | 'rendering'
  | 'open'
  | 'landed'
  | 'refine'
  | 'refining'
  | 'refined';

/** How the walk is performed. The spec walks it plainly; a film paces it and moves a pointer. */
export type Director = {
  /** The story reached a beat. `subject` is what the moment is about, for a camera to frame. */
  beat(name: Beat, subject?: Locator): Promise<void>;
  click(target: Locator): Promise<void>;
  /** Type into `field`, which already has the caret. */
  type(field: Locator, text: string): Promise<void>;
  /** Press one key in `field`: Enter takes the caret menu's highlighted row. */
  press(field: Locator, key: string): Promise<void>;
};

export const direct: Director = {
  beat: async () => {},
  click: (target) => target.click(),
  type: (field, text) => field.page().keyboard.type(text),
  press: (field, key) => field.page().keyboard.press(key),
};

/** The story's brand, created by name: the only brand a story's home should hold. */
export async function seedStoryBrand(request: APIRequestContext, story: Story): Promise<{ id: string; slug: string }> {
  const res = await request.post('/api/brands', {
    data: { brand: { specVersion: '0.1', meta: { name: story.brand } } },
  });
  if (!res.ok()) throw new Error(`seeding ${story.brand}: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { id: string; slug: string };
}

/** One portrait picture a send, set before the studio first reads its settings, whatever the browser held. */
export async function storyPrefs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('scenri:count', '1');
    localStorage.setItem('scenri:format', JSON.stringify('portrait'));
  });
}

/**
 * One earlier shot, made the way a person reuses a recipe from the wall: open it in Create, where it
 * fills the composer (its sentence and quality, never its variant count), and press Generate.
 */
export async function makeFromShowcase(page: Page, slug: string, showcaseId: string, landMs = 30_000): Promise<string> {
  await page.goto(`/${slug}/create?showcase=${showcaseId}`);
  const dock = page.locator('.sc-canvas-dock');
  await dock.locator('.sc-brief-line [data-tok]').first().waitFor();
  const sent = page.waitForResponse(postsNode);
  await dock.getByRole('button', { name: 'Generate', exact: true }).click();
  const id = firstId(await (await sent).json());
  await finished(page, id, landMs);
  return id;
}

/**
 * Walk the story on the brand at `slug`, from Home to a refined shot on the stage. Every wait is on
 * the state the next step needs, never on time; `landMs` bounds the two waits on an engine, which
 * a real one needs minutes for.
 */
export async function composeStory(
  page: Page,
  story: Story,
  slug: string,
  d: Director = direct,
  landMs = 30_000,
): Promise<{ shotId: string; refinedId: string }> {
  const dock = page.locator('.sc-canvas-dock');
  const line = dock.locator('.sc-brief-line');

  // Home, where a brand starts: what Scenri makes, and the composer under it
  await page.goto(`/${slug}`);
  const heading = page.getByRole('heading', { name: /Compose a shot/ });
  await heading.waitFor();
  await line.waitFor();
  await d.beat('home', heading);

  // the prompt, written the way a person writes one: words, with each ingredient summoned inline
  await d.click(line);
  await page.keyboard.press('End');
  await d.beat('line', line);
  let n = 0;
  for (const part of story.line) {
    if (typeof part === 'string') {
      await d.type(line, part);
      continue;
    }
    n += 1;
    await d.type(line, part.sigil + part.query);
    // Enter takes the highlighted row, and with no menu open it would send the prompt: it must be this row
    const menu = page.locator('.sc-cmd');
    await menu.locator('.sc-cmd-row[aria-selected="true"]', { hasText: part.name }).waitFor();
    await d.beat(`menu-${n}`, menu);
    await d.press(line, 'Enter');
    const chip = line.locator(`[data-tok^="${part.token}"]`);
    await chip.waitFor();
    await d.beat(`chip-${n}`, chip);
  }
  await d.beat('direction', line);

  // Home starts the shot and moves to Create, where it renders; opened at once, it lands on the stage
  const sent = page.waitForResponse(postsNode);
  await d.click(dock.getByRole('button', { name: 'Generate', exact: true }));
  const shotId = firstId(await (await sent).json());
  await d.beat('generate');
  await page.waitForURL(new RegExp(`/${slug}/create(?:[?#]|$)`));
  const tile = page.locator(`.sc-feed .sc-cell[data-fb-node="${shotId}"]`);
  await tile.waitFor();
  await d.beat('rendering', tile);
  await d.click(tile.locator('.sc-cell-open'));
  await page.waitForURL(new RegExp(`/shots/${shotId}(?:[?#]|$)`));
  await page.locator('.sc-ovl-stage').waitFor();
  await d.beat('open', page.locator('.sc-ovl-stage'));
  await onStage(page, await finished(page, shotId, landMs));
  const stage = page.locator('.sc-ovl-stage .sc-stage-img');
  await d.beat('landed', stage);

  // one refinement, said in words; the stage moves onto the new step and it lands in place
  const edit = page.locator('.sc-ovl-edit');
  const editLine = edit.locator('.sc-brief-line');
  await d.click(editLine);
  await page.keyboard.press('End');
  await d.type(editLine, story.refinement);
  await d.beat('refine', edit);
  const asked = page.waitForResponse(postsNode);
  await d.click(edit.getByRole('button', { name: 'Refine', exact: true }));
  const refinedId = ((await (await asked).json()) as { id: string }).id;
  await page.waitForURL(new RegExp(`/shots/${refinedId}(?:[?#]|$)`));
  await d.beat('refining', page.locator('.sc-ovl-stage'));
  await onStage(page, await finished(page, refinedId, landMs));
  await page.locator('.sc-ovl-head b', { hasText: 'Refinement 1' }).waitFor();
  await d.beat('refined', stage);
  return { shotId, refinedId };
}

const postsNode = (r: Response) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST';

/**
 * Wait for the engine to finish a shot, and answer its picture's hash. A failed shot fails the walk
 * at once rather than at the end of `ms`, which for a real engine is minutes.
 */
async function finished(page: Page, id: string, ms: number): Promise<string> {
  const until = Date.now() + ms;
  for (;;) {
    const res = await page.request.get(`/api/nodes/${id}`);
    const node = (await res.json()) as { status?: string; images?: string[]; error?: string | null };
    if (node.status === 'done' && node.images?.[0]) return node.images[0];
    if (node.status === 'error') throw new Error(`shot ${id} failed: ${node.error ?? 'no reason given'}`);
    if (Date.now() > until) throw new Error(`shot ${id} is still ${node.status} after ${ms}ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * The stage showing the picture with this hash, decoded, and no render box left on it. By hash,
 * because an engine can hand back the same bytes as the parent: "the picture changed" is not the
 * signal, "this step's own picture is on the stage" is.
 */
async function onStage(page: Page, hash: string): Promise<void> {
  await page.waitForFunction(
    (h) => {
      const img = document.querySelector<HTMLImageElement>('.sc-ovl-stage .sc-stage-img');
      const settled = !document.querySelector('.sc-ovl-stage .sc-stage-wait');
      return !!img && settled && (img.getAttribute('src') ?? '').includes(h) && img.complete && img.naturalWidth > 0;
    },
    hash,
    { polling: 100 },
  );
}

/** A send answers with its batch; one picture a send makes the batch the shot itself. */
function firstId(body: unknown): string {
  const b = body as { id?: string; siblings?: { id: string }[] };
  const id = b.siblings?.[0]?.id ?? b.id;
  if (!id) throw new Error(`a send answered without a shot: ${JSON.stringify(body)}`);
  return id;
}
