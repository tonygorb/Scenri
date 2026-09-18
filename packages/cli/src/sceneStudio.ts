/**
 * The scene studio's work: read a place into words, draw those words, change
 * one thing about them.
 *
 * A saved scene reaches a shot as words (`brief.ts`), so the studio's centre is
 * the reading: what the analyzer made of the person's own words and pictures,
 * which becomes the scene record when they press Use. The picture drawn here is
 * the proof of those words, not an ingredient, except for a figure-led scene,
 * whose preview is the plate a shot conditions on beside a presenter.
 *
 * Nothing here writes the brand. A job answers with a reading and a picture,
 * and the studio holds them as a version until the person uses one; only then
 * does `POST /scenes` (or a PATCH) write the record. The one exception is
 * `attach`: a scene saved while its picture was still drawing asks for that
 * picture to land on its card, the way the old background build did.
 *
 * Jobs live in memory, like the asset builds: they survive navigation and a
 * reload of the page, never a restart of the server.
 */
import { randomUUID } from 'node:crypto';
import type { SceneDraft } from '@scenri/engine-codex';
import {
  brandScenes,
  commit,
  draw,
  sceneRecordFrom,
  scenePreviewPrompt,
  trimEdgeBars,
  type AssetBuildDeps,
  type CustomScene,
} from './customAssets.js';

/** The words a scene is: what the analyzer read, or what the person wrote when nothing can read. */
export interface SceneReading {
  name: string;
  promptName?: string;
  /** The place itself, the one field every shot is given. */
  prompt: string;
  lighting: string;
  camera?: string;
  /** The position a person takes in this world, when the concept needs one. A role, never a person. */
  figure?: string;
  figureTreatment?: string;
  subject: 'product' | 'person' | 'either';
  description: string;
  keywords?: string[];
  collections?: string[];
  verticals?: string[];
}

/**
 * The three things a person asks of the studio.
 *
 * - `make`: read their words and pictures, then draw the reading.
 * - `again`: the same words, a new picture (Try again).
 * - `change`: revise the words by one sentence, keeping the rest, and change
 *   the picture by the same sentence (Change something).
 */
export type StudioJobKind = 'make' | 'again' | 'change';
export type StudioJobStatus = 'running' | 'done' | 'failed' | 'cancelled';
export type StudioPhase = 'reading' | 'changing' | 'drawing';

export interface SceneStudioJob {
  id: string;
  brandId: string;
  kind: StudioJobKind;
  status: StudioJobStatus;
  /** What is happening right now; null once it has finished. */
  phase: StudioPhase | null;
  startedAt: string;
  /** When the current phase began, for the clock on the stage. */
  phaseAt: string;
  finishedAt: string | null;
  /** Set as soon as the words are read, before the picture: the person reads while it draws. */
  reading: SceneReading | null;
  /** The analyzer's notes on what another picture would buy, or that these look like different places. */
  coverage: string[];
  hash: string | null;
  error: string | null;
  warnings: string[];
  /** A saved scene this picture belongs on once it lands. */
  attachTo: string | null;
}

export interface StudioJobInput {
  brandId: string;
  kind: StudioJobKind;
  /** The person's own words about the place: the deciding word over the pictures. */
  instruction?: string;
  /** Pictures of the place, read into words. At most `STUDIO_PICTURES_MAX`. */
  imageHashes?: string[];
  /** `again` and `change`: the words being drawn or changed. */
  reading?: SceneReading;
  /** `change`: the picture the sentence changes. Without one the new words are drawn fresh. */
  from?: string;
  /** `change`: the sentence. */
  ask?: string;
  /** `make`: draw once the words are read. False reads only. */
  draw?: boolean;
  /** `change`: read the pictures again along with the sentence, because they changed. */
  reread?: boolean;
}

/** The pictures a studio takes. Style references are one to four everywhere that measured it. */
export const STUDIO_PICTURES_MAX = 4;
const ASK_MAX = 400;
const KEEP_PER_BRAND = 24;
/** A finished job is kept long enough for a page reload to find it, not as a log. */
const KEEP_MS = 2 * 60 * 60 * 1000;

const jobs = new Map<string, SceneStudioJob>();
const running = new Map<string, AbortController>();
const tasks = new Map<string, Promise<void>>();

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });

/* ----------------------------------------------------------------- words */

const oneLine = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * A name from the words, for when nothing read them.
 *
 * The first few words of the direction, as a person would title a folder:
 * "Warm brutalist hotel lobby at dusk" is "Warm brutalist hotel lobby".
 */
export function nameFromWords(words: string): string {
  const cut = oneLine(words, 200)
    .split(/[.,;:!?\n]/)[0]
    .split(' ')
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
  if (!cut) return 'New scene';
  return (cut.charAt(0).toUpperCase() + cut.slice(1)).slice(0, 60);
}

/**
 * The words, checked by the same rules a saved scene is.
 *
 * Built through `sceneRecordFrom` so a reading can never hold something the
 * record would refuse on Use: the same caps, the same placeholder refusal, the
 * same "a treatment needs a figure".
 */
export function readingFrom(raw: unknown): { ok: true; reading: SceneReading } | { ok: false; error: string } {
  const r = (raw ?? {}) as Record<string, any>;
  const built = sceneRecordFrom({
    name: oneLine(r.name, 60) || 'New scene',
    promptName: r.promptName,
    prompt: r.prompt,
    lighting: r.lighting,
    camera: r.camera,
    figure: r.figure,
    figureTreatment: r.figureTreatment,
    subject: r.subject,
    description: r.description,
    keywords: r.keywords,
    collections: r.collections,
    verticals: r.verticals,
  });
  if (!built.ok) return built;
  return { ok: true, reading: readingOfRecord(built.scene) };
}

/** The words of a saved scene, which is how the editor opens on one. */
export function readingOfRecord(s: CustomScene): SceneReading {
  const reading: SceneReading = {
    name: s.name,
    prompt: s.prompt,
    lighting: s.lighting,
    subject: s.subject,
    description: s.description,
  };
  if (s.promptName) reading.promptName = s.promptName;
  if (s.camera) reading.camera = s.camera;
  if (s.figure) reading.figure = s.figure;
  if (s.figure && s.figureTreatment) reading.figureTreatment = s.figureTreatment;
  if (s.keywords?.length) reading.keywords = s.keywords;
  if (s.collections?.length) reading.collections = s.collections;
  if (s.verticals?.length) reading.verticals = s.verticals;
  return reading;
}

function readingOfDraft(d: SceneDraft, fallbackName: string): SceneReading {
  const checked = readingFrom({ ...d, name: d.name || fallbackName });
  if (!checked.ok) throw fail(`the reading could not be used: ${checked.error}`, 502);
  return checked.reading;
}

/** A reading as the record the preview prompt is written for. */
function asScene(r: SceneReading): CustomScene {
  return { id: 'studio', width: 1024, height: 1280, collections: [], verticals: [], ...r } as CustomScene;
}

/* --------------------------------------------------------------- picture */

/**
 * The pictures a fresh preview is drawn with.
 *
 * A shot is told this scene in words, so the preview is drawn from the words
 * alone: then it shows what a shot will actually get, and a preview that does
 * not look like the photographs is telling the truth about the words, which a
 * sentence can fix. A figure-led scene is the exception, because its preview
 * IS the plate a shot conditions on beside a presenter, and a treatment prose
 * cannot carry (the sticker lesson) has to come from the pictures.
 *
 * `SCENRI_SCENE_PREVIEW_REFS=1` restores the old draw, pictures attached for
 * every scene, as the other arm of the preview battery.
 */
export function previewRefsFor(reading: SceneReading, hashes: string[]): string[] {
  if (process.env.SCENRI_SCENE_PREVIEW_REFS === '1') return hashes;
  return reading.figure ? hashes : [];
}

/**
 * The parts of a place a sentence can be about.
 *
 * A change names one or two of them; the rest are held by name in the prompt,
 * the way a presenter adjustment holds everything about the face it did not
 * mention. The exemption is the lesson learned twice there: a keep clause that
 * lists the aspect being changed forbids the very change it asks for.
 */
const ASPECTS: { name: string; words: RegExp }[] = [
  {
    name: 'the architecture and layout',
    words:
      /\b(architecture|room|space|walls?|floors?|ceilings?|layout|windows?|doors?|building|place|location|furniture|chairs?|tables?|shelf|shelves|counters?|stairs?|arch(?:es|ed)?|columns?|plants?)\b/i,
  },
  {
    name: 'the materials and surfaces',
    words:
      /\b(materials?|concrete|marble|wood(?:en)?|stone|metal|steel|brass|chrome|glass|fabric|velvet|linen|plaster|tiles?|terrazzo|textures?|surfaces?|finish(?:es)?|polish(?:ed)?|raw|matte|gloss(?:y)?|rough|smooth|brutalist)\b/i,
  },
  {
    name: 'the light and the time of day',
    words:
      /\b(light(?:s|ing|er)?|lit|shadows?|sun(?:light|set|rise|ny)?|dusk|dawn|morning|evening|night|noon|midday|golden|hour|bright(?:er)?|dark(?:er)?|dim(?:mer)?|flash|glow|lamps?|backlit|overcast|harsh|soft(?:er)?|warm(?:er)?|cool(?:er)?)\b/i,
  },
  {
    name: 'the colour palette',
    words:
      /\b(colou?rs?|palette|tones?|hues?|warm(?:er)?|cool(?:er)?|red|orange|yellow|green|blue|purple|pink|beige|brown|black|white|gr[ae]y|pastel|muted|saturat\w*|monochrome|neutral)\b/i,
  },
  {
    name: 'the atmosphere and the weather',
    words:
      /\b(fog(?:gy)?|mist(?:y)?|haze|hazy|rain(?:y)?|snow(?:y)?|smoke|steam|weather|atmosphere|mood(?:y)?|dust(?:y)?|wet|dry)\b/i,
  },
  {
    name: 'the camera position and framing',
    words:
      /\b(camera|lens|angle|wider|wide|closer|close|lower|higher|overhead|framing|frame|crop|depth|focus|bokeh|zoom|distance|further|tighter|aerial|eye[- ]level)\b/i,
  },
];

const listed = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/**
 * What a picture is asked to become when one sentence changes it.
 *
 * The attached picture is the place as it stands; the sentence is the whole
 * change and outranks anything below it; every aspect the sentence does not
 * touch is held by name; and the revised words follow, so the picture and the
 * reading that will be saved with it agree.
 */
export function sceneChangePrompt(reading: SceneReading, ask: string): string {
  const said = oneLine(ask, ASK_MAX).replace(/[.\s]+$/, '');
  const kept = ASPECTS.filter((a) => !a.words.test(said)).map((a) => a.name);
  const hold = kept.length
    ? ` Otherwise identical to the attached image in ${listed(kept)}.`
    : ' Keep it recognisably the same place.';
  return (
    `The same place as the attached image, photographed the same way, changed only in this: ${said}. ` +
    `That change is the point of this picture and overrides anything below that describes it otherwise.${hold} ` +
    `The place as it now reads: ${scenePreviewPrompt(asScene(reading))}`
  );
}

async function drawFresh(
  deps: AssetBuildDeps,
  brandId: string,
  reading: SceneReading,
  hashes: string[],
  signal: AbortSignal,
): Promise<string> {
  const engine = deps.engine!;
  const refs = previewRefsFor(reading, hashes)
    .filter((h) => deps.core.images.has(h))
    .slice(0, engine.capabilities().maxReferenceImages)
    .map((h) => deps.core.images.pathFor(h));
  return draw(deps, {
    prompt: scenePreviewPrompt(asScene(reading)),
    brandId,
    ...(refs.length ? { referenceImages: refs, referenceRoles: refs.map(() => 'scene' as const) } : {}),
    signal,
  });
}

/**
 * The picture changed by one sentence.
 *
 * An edit where the engine has one, which is what keeps the architecture when
 * only the walls were asked about; the picture attached as the reference where
 * it does not; drawn fresh from the new words where the engine reads no image
 * at all, which is honest if not faithful.
 */
async function drawChange(
  deps: AssetBuildDeps,
  brandId: string,
  reading: SceneReading,
  from: string,
  ask: string,
  hashes: string[],
  signal: AbortSignal,
): Promise<string> {
  const engine = deps.engine!;
  const caps = engine.capabilities();
  if (!deps.core.images.has(from)) return drawFresh(deps, brandId, reading, hashes, signal);
  const prompt = sceneChangePrompt(reading, ask);
  if (caps.supportsEdit) {
    const brand = deps.brandContext(brandId);
    const probe = { prompt, brand, width: 1024, height: 1280, count: 1 };
    const estimate = await engine.costEstimate(probe).catch(() => 0);
    deps.core.ledger.assertUnderCap(caps.id, estimate);
    const result = await engine.edit(
      { instruction: prompt, sourceImage: deps.core.images.pathFor(from), brand },
      signal,
    );
    deps.core.ledger.recordCost(caps.id, null, result.costUsd);
    const hash = result.images[0];
    if (!hash) throw fail('the engine returned no image', 502);
    return hash;
  }
  if (caps.maxReferenceImages > 0) {
    return draw(deps, {
      prompt,
      brandId,
      referenceImages: [deps.core.images.pathFor(from)],
      referenceRoles: ['scene'],
      signal,
    });
  }
  return drawFresh(deps, brandId, reading, hashes, signal);
}

/* ------------------------------------------------------------------ jobs */

const now = () => new Date().toISOString();

function patch(job: SceneStudioJob, next: Partial<SceneStudioJob>) {
  Object.assign(job, next);
}

function prune(brandId: string) {
  const cutoff = Date.now() - KEEP_MS;
  const mine = [...jobs.values()].filter((j) => j.brandId === brandId);
  for (const j of mine) if (j.finishedAt && Date.parse(j.finishedAt) < cutoff) jobs.delete(j.id);
  const left = [...jobs.values()]
    .filter((j) => j.brandId === brandId && j.status !== 'running')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  while (left.length > KEEP_PER_BRAND) jobs.delete(left.shift()!.id);
}

/** Put a landed picture on a scene that was saved while it was drawing. */
function landOn(deps: AssetBuildDeps, brandId: string, sceneId: string, hash: string): boolean {
  const brand = deps.core.store.getBrand(brandId);
  if (!brandScenes(brand?.json ?? {}).some((s: any) => s?.id === sceneId)) return false;
  commit(deps.core, brandId, (json) => {
    json.scenes = brandScenes(json).map((s: any) => (s.id === sceneId ? { ...s, preview: `asset:${hash}` } : s));
  });
  return true;
}

/**
 * Start one piece of studio work. Refuses what could never succeed before
 * anything is spent, and answers with the job the studio then polls.
 */
export function startSceneStudioJob(deps: AssetBuildDeps, input: StudioJobInput): { jobId: string } {
  const kind = input.kind;
  if (kind !== 'make' && kind !== 'again' && kind !== 'change') throw fail('kind must be make, again or change');
  const instruction = String(input.instruction ?? '')
    .trim()
    .slice(0, 400);
  const hashes = [...new Set((input.imageHashes ?? []).map(String))]
    .filter((h) => /^[a-f0-9]{32}$/.test(h) && deps.core.images.has(h))
    .slice(0, STUDIO_PICTURES_MAX);
  let reading: SceneReading | undefined;
  if (input.reading !== undefined) {
    const checked = readingFrom(input.reading);
    if (!checked.ok) throw fail(checked.error);
    reading = checked.reading;
  }
  const ask = oneLine(input.ask, ASK_MAX);
  if (kind === 'make') {
    if (!instruction && !hashes.length) throw fail('describe the place, or add a picture of it');
    if (!instruction && !deps.analyzer)
      throw fail('Reading pictures needs Codex. Describe the place in words, or set up Codex.');
  }
  if (kind === 'again') {
    if (!reading) throw fail('there are no words to draw yet');
    if (!deps.engine) throw fail('no engine here can draw a preview');
  }
  if (kind === 'change') {
    if (!reading) throw fail('there are no words to change yet');
    if (!ask) throw fail('say what to change');
  }

  const at = now();
  const job: SceneStudioJob = {
    id: randomUUID(),
    brandId: input.brandId,
    kind,
    status: 'running',
    phase: kind === 'again' ? 'drawing' : kind === 'change' ? 'changing' : 'reading',
    startedAt: at,
    phaseAt: at,
    finishedAt: null,
    reading: kind === 'again' ? (reading ?? null) : null,
    coverage: [],
    hash: null,
    error: null,
    warnings: [],
    attachTo: null,
  };
  jobs.set(job.id, job);
  prune(input.brandId);
  const ctrl = new AbortController();
  running.set(job.id, ctrl);
  const work = run(deps, job, { ...input, instruction, imageHashes: hashes, reading, ask }, ctrl.signal).finally(() => {
    running.delete(job.id);
    tasks.delete(job.id);
  });
  tasks.set(job.id, work);
  return { jobId: job.id };
}

async function read(
  deps: AssetBuildDeps,
  job: SceneStudioJob,
  input: StudioJobInput,
  signal: AbortSignal,
): Promise<SceneReading> {
  const instruction = input.instruction || undefined;
  const hashes = input.imageHashes ?? [];
  const prior = input.kind === 'change' ? input.reading : undefined;
  const fallback = prior?.name || nameFromWords(instruction ?? '');
  if (deps.analyzer) {
    // A change to the words is made to the words: the pictures were read into
    // them already, and reading them again invites the whole record to be
    // re-derived around one sentence. They go back in only when they changed.
    const imagePaths = prior && !input.reread ? [] : hashes.map((h) => deps.core.images.pathFor(h));
    const draft = (await deps.analyzer.analyze(
      {
        kind: 'scene',
        imagePaths,
        name: '',
        instruction,
        ...(prior ? { priorDraft: prior, correction: input.ask } : {}),
        vocabulary: deps.vocabulary,
      },
      signal,
    )) as SceneDraft;
    patch(job, { coverage: Array.isArray(draft.coverage) ? draft.coverage.slice(0, 2) : [] });
    return readingOfDraft(draft, fallback);
  }
  // Nothing on this machine reads. The person's words are the scene as they
  // wrote them, and a change is added to them in their own words too.
  if (prior) {
    const checked = readingFrom({ ...prior, prompt: `${prior.prompt.replace(/[.\s]+$/, '')}. ${input.ask}` });
    if (!checked.ok) throw fail(checked.error);
    return checked.reading;
  }
  const checked = readingFrom({ name: fallback, prompt: instruction, description: instruction });
  if (!checked.ok) throw fail(checked.error);
  return checked.reading;
}

async function run(deps: AssetBuildDeps, job: SceneStudioJob, input: StudioJobInput, signal: AbortSignal) {
  try {
    let reading = input.reading ?? null;
    if (input.kind !== 'again') {
      reading = await read(deps, job, input, signal);
      if (signal.aborted) throw fail('cancelled');
      patch(job, { reading });
    }
    const wantsPicture = input.kind !== 'make' || input.draw !== false;
    if (wantsPicture && deps.engine && reading) {
      patch(job, { phase: 'drawing', phaseAt: now() });
      const hashes = input.imageHashes ?? [];
      const drawn =
        input.kind === 'change' && input.from
          ? await drawChange(deps, job.brandId, reading, input.from, input.ask ?? '', hashes, signal)
          : await drawFresh(deps, job.brandId, reading, hashes, signal);
      if (signal.aborted) throw fail('cancelled');
      // The same trim every scene preview gets: a figure-led preview is a
      // conditioning image, and baked-in bars would be reproduced into shots.
      const hash = await trimEdgeBars(deps.core, drawn);
      patch(job, { hash });
      if (job.attachTo && !landOn(deps, job.brandId, job.attachTo, hash))
        patch(job, { warnings: [...job.warnings, 'The scene was gone before its picture landed.'] });
    }
    patch(job, { status: 'done', phase: null, finishedAt: now() });
  } catch (err: any) {
    if (signal.aborted) patch(job, { status: 'cancelled', phase: null, finishedAt: now() });
    else
      patch(job, {
        status: 'failed',
        phase: null,
        finishedAt: now(),
        error: String(err?.message ?? err ?? 'the studio could not finish'),
      });
  }
}

export function getSceneStudioJob(id: string): SceneStudioJob | undefined {
  return jobs.get(id);
}

export function cancelSceneStudioJob(id: string): boolean {
  const ctrl = running.get(id);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

/**
 * The picture this job is drawing belongs on a saved scene.
 *
 * `landed` when it was already there and is on the card now; `pending` when it
 * will be put there as it lands; `none` when the job ended without one.
 */
export function attachSceneStudioJob(deps: AssetBuildDeps, id: string, sceneId: string): 'landed' | 'pending' | 'none' {
  const job = jobs.get(id);
  if (!job) return 'none';
  if (job.status === 'running') {
    patch(job, { attachTo: sceneId });
    return 'pending';
  }
  if (job.status === 'done' && job.hash) return landOn(deps, job.brandId, sceneId, job.hash) ? 'landed' : 'none';
  return 'none';
}

/** Counted by the updater, which refuses to restart over work in flight. */
export function runningSceneStudioCount(): number {
  return running.size;
}

/** Stop everything and wait for it to settle: a server going away, or a test tearing down. */
export async function settleSceneStudio(): Promise<void> {
  for (const ctrl of running.values()) ctrl.abort();
  await Promise.allSettled([...tasks.values()]);
}

export function resetSceneStudio(): void {
  for (const ctrl of running.values()) ctrl.abort();
  jobs.clear();
  running.clear();
  tasks.clear();
}
