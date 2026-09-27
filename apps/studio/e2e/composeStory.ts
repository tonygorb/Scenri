import type { APIRequestContext, Locator, Page, Response } from '@playwright/test';

/**
 * The compose story, walked the way a person walks it: a brand with work behind it, a prompt
 * written with each ingredient summoned inline by its sigil, a shot generated and watched landing
 * among the brand's earlier work, then opened and refined in words, one step at a time.
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
   * The brand's earlier work, oldest first: showcase recipes (templates/showcase) remade before the
   * story starts, so Create opens on a feed that has been used rather than an empty one.
   */
  history: string[];
  /** The prompt as a person writes it: words, and ingredients inline. It is the whole direction: nothing else is sent. */
  line: (string | Pick)[];
  /** The refinements, in order, each typed on the step before it. */
  refinements: string[];
};

/** The public recipe templates/showcase/barrier-cream-caddy.json, written as one sentence. */
export const barrierCream: Story = {
  brand: 'Fenwick Slade',
  // the brand's world, then the product's other shipped recipes as the newest; the caddy itself is
  // left out, it is the shot being made
  history: [
    'c15-morning-drop',
    'wash-slate-shower',
    'orris-collarbone',
    'spf-poolside',
    'c15-apricot-ledge',
    'sun-coin-collarbone',
    'fig-leaf-lanterns',
    'collagen-morning-shake',
    'wash-fig-leaves',
    'hibiscus-dew-bed',
    'gummies-bedside',
    'barrier-cream-ice-core',
    'barrier-cream-oats',
    'barrier-cream-cheek',
  ],
  line: [
    { sigil: '$', query: 'barr', name: 'Barrier Cream', token: 'p:fenwick-slade-barrier-cream' },
    ' on the ',
    { sigil: '/', query: 'bath', name: 'Bath Caddy', token: 't:teak-bath-caddy' },
    ', lid off, centred in the hard sun.',
  ],
  // the light, then the camera: the same jar, told twice more. A refinement keeps the photograph
  // (briefDirectives.ts), so it will not move the camera to a new viewpoint: "Low side angle, close
  // on the jar", "Eye level with the jar, from the side" and "New angle: ..." all came back as the
  // same view. It will widen the frame, which is the move that shows the whole scene
  refinements: ['Golden hour, long warm shadows', 'Pull back to show the whole bath'],
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
  | 'landed'
  | 'open'
  | `refine-${number}`
  | `refining-${number}`
  | `refined-${number}`;

/** Every beat the story reaches, in order, for a caller that checks them. */
export function beatsOf(story: Story): Beat[] {
  const picks = story.line.filter((p) => typeof p !== 'string').length;
  const chips = Array.from({ length: picks }, (_, i) => [`menu-${i + 1}`, `chip-${i + 1}`] as Beat[]).flat();
  const steps = story.refinements
    .map((_, i) => [`refine-${i + 1}`, `refining-${i + 1}`, `refined-${i + 1}`] as Beat[])
    .flat();
  return ['home', 'line', ...chips, 'direction', 'generate', 'rendering', 'landed', 'open', ...steps];
}

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
 * Walk the story on the brand at `slug`, from Home to its last refinement on the stage. Every wait
 * is on the state the next step needs, never on time; `landMs` bounds each wait on an engine,
 * which a real one needs minutes for.
 *
 * `warm` first walks to Create and back through the app's own navigation, as someone who has been
 * working would have: every picture on both pages is then one this session has already decoded,
 * so it is shown at once instead of fading in, and the only thing that arrives on camera is the
 * shot being made.
 */
export async function composeStory(
  page: Page,
  story: Story,
  slug: string,
  d: Director = direct,
  { landMs = 30_000, warm = false }: { landMs?: number; warm?: boolean } = {},
): Promise<{ shotId: string; refinedIds: string[] }> {
  const dock = page.locator('.sc-canvas-dock');
  const line = dock.locator('.sc-brief-line');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const heading = page.getByRole('heading', { name: /Compose a shot/ });

  // Home, where a brand starts: what Scenri makes, and the composer under it
  await page.goto(`/${slug}`);
  await heading.waitFor();
  await line.waitFor();
  if (warm) {
    await pictures(page);
    await nav.getByRole('link', { name: 'Create', exact: true }).click();
    await page.waitForURL(new RegExp(`/${slug}/create(?:[?#]|$)`));
    await page.locator('.sc-feed .sc-cell').first().waitFor();
    await pictures(page);
    await nav.getByRole('link', { name: 'Home', exact: true }).click();
    await heading.waitFor();
  }
  await pictures(page);
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

  // Home starts the shot and moves to Create, where it renders among the brand's work and lands there
  const sent = page.waitForResponse(postsNode);
  await d.click(dock.getByRole('button', { name: 'Generate', exact: true }));
  const shotId = firstId(await (await sent).json());
  await d.beat('generate');
  await page.waitForURL(new RegExp(`/${slug}/create(?:[?#]|$)`));
  const tile = page.locator(`.sc-feed .sc-cell[data-fb-node="${shotId}"]`);
  await tile.waitFor();
  await d.beat('rendering', tile);
  await finished(page, shotId, landMs);
  await tile.locator('.sc-cellimg[data-loaded]').waitFor();
  await d.beat('landed', tile);

  // the finished shot, opened on the stage
  await d.click(tile.locator('.sc-cell-open'));
  await page.waitForURL(new RegExp(`/shots/${shotId}(?:[?#]|$)`));
  const stage = page.locator('.sc-ovl-stage .sc-stage-img');
  await onStage(page, await finished(page, shotId, landMs));
  await d.beat('open', stage);

  // each refinement said in words on the step before it; the stage moves onto the new step and it lands in place
  const refinedIds: string[] = [];
  for (const [i, words] of story.refinements.entries()) {
    refinedIds.push(await refineOnStage(page, words, i + 1, d, landMs));
  }
  return { shotId, refinedIds };
}

/** Open a shot on the stage, finished: where a refinement is said. */
export async function openShot(page: Page, slug: string, shotId: string, landMs = 30_000): Promise<void> {
  await page.goto(`/${slug}/create/shots/${shotId}`);
  await onStage(page, await finished(page, shotId, landMs));
}

/**
 * Say one refinement of the shot on the stage, as step `step` of the story: type it on the step,
 * press Refine, and wait for the new step to land in place. Answers the new step's id.
 */
export async function refineOnStage(
  page: Page,
  words: string,
  step: number,
  d: Director = direct,
  landMs = 30_000,
): Promise<string> {
  const edit = page.locator('.sc-ovl-edit');
  const editLine = edit.locator('.sc-brief-line');
  await d.click(editLine);
  await page.keyboard.press('End');
  await d.type(editLine, words);
  await d.beat(`refine-${step}`, edit);
  const asked = page.waitForResponse(postsNode);
  await d.click(edit.getByRole('button', { name: 'Refine', exact: true }));
  const id = ((await (await asked).json()) as { id: string }).id;
  await page.waitForURL(new RegExp(`/shots/${id}(?:[?#]|$)`));
  await d.beat(`refining-${step}`, page.locator('.sc-ovl-stage'));
  await onStage(page, await finished(page, id, landMs));
  // the head names the step; a step drawn again beside an earlier one may carry another number
  await page.locator('.sc-ovl-head b', { hasText: /^Refinement \d+$/ }).waitFor();
  await d.beat(`refined-${step}`, page.locator('.sc-ovl-stage .sc-stage-img'));
  return id;
}

const postsNode = (r: Response) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST';

/** Every picture in view decoded, so what the page shows is finished rather than arriving. */
async function pictures(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Array.from(document.images).every((img) => {
        const r = img.getBoundingClientRect();
        const seen = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && r.width > 0;
        return !seen || (img.complete && img.naturalWidth > 0);
      }),
    undefined,
    { polling: 100 },
  );
}

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
