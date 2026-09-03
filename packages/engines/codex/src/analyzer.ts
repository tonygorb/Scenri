/**
 * Reference analysis: turns a person's own photos, or a pile of inspiration
 * images, into the structured record Scenri's catalogs already use.
 *
 * This is the half of the product the user is not asked to do. They supply the
 * evidence; this reads it into `identityNotes` / `negativeConstraints` for a
 * person, or into a scene's `prompt` / `lighting` / `subject` for a place.
 *
 * Two rules shape both prompts:
 *  - A person is described, never identified. We say what is visible; we never
 *    guess who they are.
 *  - A scene reference is a world, not a picture. Whatever product, logo or
 *    model happens to be standing in the reference is explicitly discarded, so
 *    someone else's campaign can never become part of a reusable scene.
 *
 * Codex writes its answer to a file. The transcript on stdout is never parsed:
 * it is a narration of the work, not the work.
 */
import type { spawn as nodeSpawn } from 'node:child_process';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EngineAvailability } from '@scenri/core';
import { createRunner, execArgs, type CodexRunner, type RunnerOptions } from './run.js';

export interface AnalyzeRequest {
  kind: 'presenter' | 'scene';
  /** Absolute paths to the user's references. May be empty for a scene built from words alone. */
  imagePaths: string[];
  /** What the user calls this asset. Never sent as the generator's name for it. */
  name: string;
  /** The user's own words about what they want, in free text. */
  instruction?: string;
  /** A short correction on a re-analysis, e.g. "less orange, more daylight". */
  correction?: string;
  /** The record being corrected, so a re-analysis revises rather than restarts. */
  priorDraft?: unknown;
  /** Allowed facet values, so a new asset lands in the filters that already exist. */
  vocabulary?: { collections?: string[]; verticals?: string[]; categories?: string[] };
}

export interface PresenterDraft {
  promptName: string;
  presentation: 'woman' | 'man';
  descriptor: string;
  ageRange: string;
  hair: string;
  identityNotes: string;
  negativeConstraints: string[];
  /** Which industries this person suits, from the filters that already exist. */
  suitableCategories: string[];
  /** Non-blocking notes on which further view would make this person more consistent. */
  coverage: string[];
}

export interface SceneDraft {
  name?: string;
  promptName: string;
  lighting: string;
  description: string;
  subject: 'product' | 'person' | 'either';
  collections: string[];
  verticals: string[];
  keywords: string[];
  prompt: string;
  camera?: string;
  /**
   * The figure the concept depends on, when it depends on one.
   *
   * Not "where a body goes". A world can be built around a person so completely
   * that the person IS the concept - a close portrait whose whole art direction
   * is what has been done to the face. Recording only a position throws that
   * away, which is exactly how a sticker-covered portrait came back as an empty
   * room. What it never carries is who they are.
   *
   * Absent means no intrinsic figure. Softer, ambient human presence - someone
   * crossing the far end of a lobby, worn seats, a table laid for two - stays in
   * `prompt` with the rest of the set, the way the shipped catalog writes it.
   */
  figure?: string;
  /**
   * What is applied TO that figure: stickers over the face, paint, a veil, a
   * mask, fabric, reduction to a silhouette.
   *
   * Separate from `figure` because it collides with something `figure` does not.
   * A presenter's directives lock "their face, facial structure, skin, hair and
   * build" and 19 of the 21 curated presenters carry notes saying as much. The
   * compiler reconciles that by scope rather than by contradiction - identity is
   * what sits under the treatment, the treatment is the layer over it - and it
   * can only say so if the treatment arrives as its own field.
   */
  figureTreatment?: string;
  /** Non-blocking notes on what another reference would buy. Mirrors PresenterDraft. */
  coverage: string[];
}

export interface CodexAnalyzer {
  isAvailable(): Promise<EngineAvailability>;
  analyze(req: AnalyzeRequest, signal?: AbortSignal): Promise<PresenterDraft | SceneDraft>;
}

export interface CodexAnalyzerOptions extends RunnerOptions {
  spawnImpl?: typeof nodeSpawn;
  /** The process-wide runner, so analysis shares the engine's probe cache. */
  runner?: CodexRunner;
}

const OUT_FILE = 'analysis.json';

export function createCodexAnalyzer(opts: CodexAnalyzerOptions = {}): CodexAnalyzer {
  const runner = opts.runner ?? createRunner(opts);

  return {
    isAvailable: () => runner.probe(),

    async analyze(req: AnalyzeRequest, signal?: AbortSignal): Promise<PresenterDraft | SceneDraft> {
      return runner.withWorkDir(async (dir) => {
        const refs: string[] = [];
        for (const [i, src] of req.imagePaths.entries()) {
          const dest = join(dir, `ref-${i + 1}.png`);
          await copyFile(src, dest);
          refs.push(dest);
        }

        // One retry, and only one: a second failure is a broken binary or a
        // model that cannot follow the contract, and both want a human.
        let problems: string[] = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          const args = execArgs(dir, 'high');
          for (const ref of refs) {
            // --image is variadic; the = form binds exactly one value so the
            // positional stdin marker isn't swallowed as a second image path.
            args.splice(args.length - 1, 0, `--image=${ref}`);
          }
          await runner.run(args, signal, {
            stdin: buildPrompt(req, refs.length, problems),
            label: `analyze refs=${refs.length} attempt=${attempt + 1}`,
          });

          let raw: string;
          try {
            raw = await readFile(join(dir, OUT_FILE), 'utf8');
          } catch {
            problems = [`No ${OUT_FILE} was written.`];
            continue;
          }
          const parsed = parseDraft(req, raw);
          if (parsed.ok) return parsed.draft;
          problems = parsed.problems;
        }
        throw new Error(`Codex could not describe these references: ${problems.join(' ')}`);
      });
    },
  };
}

/* ---------------------------------------------------------------- prompts */

function buildPrompt(req: AnalyzeRequest, refCount: number, problems: string[]): string {
  const evidence =
    refCount === 0
      ? 'You have no reference images. Work from the description alone.'
      : refCount === 1
        ? 'One reference image is attached.'
        : `${refCount} reference images are attached.`;
  const body = req.kind === 'presenter' ? presenterBody(req, refCount) : sceneBody(req, refCount);
  const revision = req.priorDraft
    ? ` You are revising an existing record, not starting over: keep everything that is not being corrected. Current record: ${JSON.stringify(req.priorDraft)}.`
    : '';
  const correction = req.correction ? ` The correction to apply: ${req.correction}.` : '';
  const retry = problems.length
    ? ` Your last answer was rejected: ${problems.join(' ')} Fix exactly that and write the file again.`
    : '';
  return (
    `${evidence}${revision}${correction} ${body}` +
    ` Write strict JSON, and nothing but JSON, to a file called ${OUT_FILE} in the current directory` +
    ` (you may run the commands needed to write it). Do not browse the web or explore files.` +
    ` No prose, no markdown fences, no commentary.${retry}`
  );
}

function presenterBody(req: AnalyzeRequest, refCount: number): string {
  const same = refCount > 1 ? ' Every attached photograph is the same person.' : '';
  const ask = req.instruction ? ` The person who supplied these adds: ${req.instruction}.` : '';
  const categories = req.vocabulary?.categories?.length
    ? ` Choose "suitableCategories" only from this list: ${req.vocabulary.categories.join(', ')}.`
    : '';
  return (
    `These are photographs of one person, supplied by the person casting them.${same}${ask}` +
    ' Write a casting sheet: what a photographer would need in order to recognise this person again in a different shot.' +
    ' Do not name, identify, or guess who this person is, and do not use any proper name anywhere in your answer.' +
    ' Describe the person, not the photograph: their build, face and hair belong to them, but the background, crop, pose, clothing and lighting of these pictures belong to a shoot and must be left out.' +
    ` ${OUT_FILE} must be a JSON object with exactly these keys:` +
    ' "promptName": a short noun phrase a generator can be handed, such as "a woman in her early thirties with dark shoulder-length waves";' +
    ' "presentation": either "woman" or "man";' +
    ' "descriptor": a three-beat casting caption joined by " · ", such as "Warm editorial · dark waves · composed";' +
    ' "ageRange": an approximate range such as "early 30s";' +
    ' "hair": colour, length, texture and how it is worn;' +
    ' "identityNotes": one paragraph naming the two or three features that must survive every generation, drawn from face shape, eyes, nose, mouth, jaw, skin, distinctive marks, and build where it is visible;' +
    ' "negativeConstraints": an array of short refusals for the drift these photographs invite, such as "no youth-smoothing that erases the natural lines";' +
    ` "suitableCategories": the industries this person would be cast for.${categories}` +
    ' "coverage": an array of at most two short sentences naming a view that is missing and would make this person more consistent, such as "A three-quarter photo would pin the cheekbones down." Use an empty array when the coverage is already good.'
  );
}

function sceneBody(req: AnalyzeRequest, refCount: number): string {
  // The user's own direction, and it outranks the pictures.
  //
  // This used to read "What the person wants from it: X" - a wish, with no
  // authority to settle anything. With one reference the pictures are often
  // ambiguous about what is the concept and what merely happened to be in the
  // frame, and the person who chose them is the only one who knows.
  const ask = req.instruction
    ? ` The person who chose these references says what matters in them: ${req.instruction}.` +
      ' Treat that as the deciding word: whatever it calls essential IS essential even if only one reference shows it,' +
      ' and whatever it tells you to ignore stays out even if every reference contains it.'
    : '';
  const collections = req.vocabulary?.collections?.length
    ? ` Choose "collections" only from this list: ${req.vocabulary.collections.join(', ')}.`
    : '';
  const verticals = req.vocabulary?.verticals?.length
    ? ` Choose "verticals" only from this list: ${req.vocabulary.verticals.join(', ')}.`
    : '';
  return (
    `These are references for a place, not a picture to copy.${ask}` +
    ' Extract the reusable visual world behind them: environment, architecture, surfaces and materials,' +
    ' the character of the light, atmosphere, palette, depth, and the photographic language.' +
    // The old prompt asked for "materials" and "depth" in the abstract and got
    // "a modern room" back. These four are the axes that actually came back thin.
    ' Name materials rather than colours - travertine, cracked clay, waxed canvas, brushed steel, raw concrete -' +
    ' and say how the space layers from foreground through middle ground to background.' +
    ' Say so when a surface is reflective or transmissive: a mirror, a wet floor, chrome, glass, still water.' +
    ' Those govern how everything in the frame is lit, and they are the first thing lost to a generic description.' +
    ' Treat signage and lettering as typographic texture belonging to the environment: say that it is there and what it is made of,' +
    ' and never transcribe the words or name the brand.' +
    // The correction this prompt exists to make. "Leave it out completely" was
    // read, correctly, as an instruction to describe an empty room.
    ' What you leave out is identity, not presence.' +
    ' Never name or describe a brand, a logo, a product model or a wordmark, and do not use any proper name anywhere in your answer.' +
    ' A person in a reference is recorded only as a figure: their scale in the frame, their distance, their posture,' +
    ' the kind of act the space is arranged around, and how a body catches this light.' +
    ' Never their face, hair, age, wardrobe, or anything that would identify them, and never as a particular person -' +
    ' "a figure at the water\'s edge", never "a woman in a red coat".' +
    // The correction this revision exists to make. A figure can BE the concept.
    ' A figure is not always something standing in a world. Sometimes the figure IS the world:' +
    ' a close portrait whose entire art direction is what has been done to the person - a face covered in stickers,' +
    ' painted skin, a veil, a mask, fabric wrapped over the head, a body reduced to a silhouette.' +
    ' When that is what the reference is, the treatment is the single most important thing to record, not a detail to drop' +
    ' along with the identity. Record what was done; never who it was done to.' +
    ' Only a living person counts as a figure. A mannequin, a statue, a face on a poster, a billboard or a screen,' +
    ' a reflection with nobody outside it, or a cast shadow is a thing in the environment: describe it in the set, not as a figure.' +
    ' Where several people appear, only the one the composition is built around is the figure;' +
    ' the rest are crowd, and belong in the set with everything else.' +
    ' A product, garment or mark staged in a reference is a visitor: leave the object itself out,' +
    ' but keep what it tells you about the place - the surface it sat on, the scale it implies, how densely the space is dressed.' +
    ' Where several references are attached, the world is what they share; whatever appears in only one of them is a visitor.' +
    ' Use no placeholders of any kind.' +
    ` ${OUT_FILE} must be a JSON object with exactly these keys:` +
    ' "name": two or three words a person would call this place, such as "Wet Basalt Shore";' +
    ' "promptName": the same place named for a generator, at most six words;' +
    ' "lighting": a short phrase naming the light, such as "Low directional sunset, long shadows across wet stone";' +
    ' "description": one sentence a person reads on a card;' +
    ' "subject": "product" if this world suits a staged object, "person" if it suits someone photographed in it, "either" when it truly suits both;' +
    ' "prompt": four or five sentences describing the set itself, in the present tense, naming nothing branded and nobody identifiable.' +
    // "a figure far off in the frame" used to be offered here as ambience, and
    // it walked into the reusable prose of scenes that had no one in them: a
    // flower field described with a distant figure rendered that figure on
    // every product-only shot. Traces are the set's; a body is the figure's.
    ' Human presence belongs here only as the traces a set carries - worn seats, a table dressed for two, a path worn through the grass -' +
    ' never as a body in the frame; a person is recorded under "figure" or not at all;' +
    // The bias ran the other way too: "empty only when the concept genuinely
    // survives with nobody" set a figure on every custom scene in a real
    // library. A figure is evidence of a person, never room for one.
    ' "figure": one short phrase for the role a person plays, ONLY when a reference is built around a person,' +
    ' or when the person who chose these references names one -' +
    ' their framing, their scale, and what they are doing - such as "someone is seated at the stone ledge, mid-ground, at human scale"' +
    ' or "one person at close portrait range, squared to camera, filling the frame".' +
    ' A portrait counts. If the reference is built around a person and would stop being this concept without one, that is a figure,' +
    ' however much of the frame they occupy.' +
    ' A landscape, a field, a room, a surface, a still life or an empty set has no figure: write an empty string,' +
    ' and never add one because the world could hold a person.' +
    ' Passers-by and people who merely happened to be in a reference are not a figure either;' +
    ' what the set keeps of them goes in "prompt" with the rest of the set.' +
    (refCount === 0 ? ' With no reference images, write a figure only if the description itself names a person.' : '') +
    ' This is a different question from "subject": "subject" is who this world flatters, "figure" is whether the concept needs a body at all;' +
    ' "figureTreatment": what has been done TO that figure, when something has - one short phrase, such as' +
    ' "the face entirely covered in overlapping printed stickers" or "the head and shoulders wrapped in translucent fabric".' +
    ' Describe the treatment, what it is made of, and the character of any printing on it - the kind of label or' +
    ' product it imitates, its typographic style, illustration and colour - because that graphic character is' +
    ' usually the point. Say what kind of thing the printing is without naming a real company from the references.' +
    // Faithful to THESE references, not to the idea of them. Two pictures of
    // the same treatment can differ in how much of the face is covered and in
    // what the pieces are made of, and flattening that to "densely covered"
    // loses the thing the user chose these particular pictures for.
    ' Be specific to what is actually in front of you rather than to the general idea: how much of the surface is' +
    ' covered and how much is left bare, the material and finish - glossy vinyl, matte paper, foil, fabric - the' +
    ' size of the pieces, and - separately from how many there are - how far they reach across the form and which' +
    ' parts they land on, since a treatment can be sparse and still cover the whole face.' +
    ' If the references disagree about how heavy it is, give the range rather than picking one.' +
    ' Use an empty string when nothing has been done to them. Leave it empty too when "figure" is empty;' +
    ' "camera": the camera tendency of this world in a short phrase - height, distance, lens feel, depth of field - or an empty string when it has none.' +
    ' Camera belongs here and never in "prompt";' +
    ' "keywords": five to ten single words someone might search for;' +
    ' "coverage": an array of at most two short sentences naming what another reference would buy, such as' +
    ' "A wider frame would pin down how the room is laid out." Say so here if these references look like different places,' +
    ' or if they are mostly a person or a packshot with too little environment to build a world from. Use an empty array when they are good;' +
    ` "collections": one or two themed groupings;${collections}` +
    ` "verticals": the industries this world flatters.${verticals}`
  );
}

/* --------------------------------------------------------------- parsing */

type ParseResult = { ok: true; draft: PresenterDraft | SceneDraft } | { ok: false; problems: string[] };

/** Tolerate a fenced or padded file; refuse anything that is not the contract. */
function parseDraft(req: AnalyzeRequest, raw: string): ParseResult {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ok: false, problems: [`${OUT_FILE} was not valid JSON (${(err as Error).message}).`] };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, problems: [`${OUT_FILE} must hold a JSON object.`] };
  }
  return req.kind === 'presenter'
    ? parsePresenter(req, json as Record<string, unknown>)
    : parseScene(req, json as Record<string, unknown>);
}

function parsePresenter(req: AnalyzeRequest, o: Record<string, unknown>): ParseResult {
  const problems: string[] = [];
  const promptName = str(o.promptName);
  const identityNotes = str(o.identityNotes);
  if (!promptName) problems.push('"promptName" was missing or empty.');
  if (!identityNotes) problems.push('"identityNotes" was missing or empty.');
  const presentation = str(o.presentation).toLowerCase();
  if (presentation !== 'woman' && presentation !== 'man') {
    problems.push('"presentation" must be exactly "woman" or "man".');
  }
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    draft: {
      promptName: cap(promptName, 240),
      presentation: presentation as 'woman' | 'man',
      descriptor: cap(str(o.descriptor), 120),
      ageRange: cap(str(o.ageRange), 40),
      hair: cap(str(o.hair), 120),
      identityNotes: cap(identityNotes, 900),
      negativeConstraints: list(o.negativeConstraints, 6, 160),
      suitableCategories: pick(o.suitableCategories, req.vocabulary?.categories, 6),
      coverage: list(o.coverage, 2, 160),
    },
  };
}

function parseScene(req: AnalyzeRequest, o: Record<string, unknown>): ParseResult {
  const problems: string[] = [];
  const prompt = str(o.prompt);
  if (!prompt) problems.push('"prompt" was missing or empty.');
  // The whole point of the model: the set never names what is staged in it.
  if (/\{[^}]*\}/.test(prompt)) problems.push('"prompt" contained a {placeholder}; write the set out in words.');
  const lighting = str(o.lighting);
  if (!lighting) problems.push('"lighting" was missing or empty.');
  const subject = str(o.subject).toLowerCase();
  if (subject !== 'product' && subject !== 'person' && subject !== 'either') {
    problems.push('"subject" must be exactly "product", "person" or "either".');
  }
  if (problems.length) return { ok: false, problems };
  const camera = cap(str(o.camera), 200);
  // Non-blocking, exactly like `camera`: a model that omits or fumbles these
  // must not burn the single retry that exists for a broken contract.
  const figure = oneLine(o.figure, 120);
  // A treatment without a figure describes nothing, so it never survives alone.
  const figureTreatment = figure ? oneLine(o.figureTreatment, 160) : '';
  return {
    ok: true,
    draft: {
      name: cap(str(o.name), 60) || undefined,
      promptName: cap(str(o.promptName) || str(o.name), 60),
      lighting: cap(lighting, 200),
      description: cap(str(o.description), 400),
      subject: subject as 'product' | 'person' | 'either',
      collections: pick(o.collections, req.vocabulary?.collections, 2),
      verticals: pick(o.verticals, req.vocabulary?.verticals, 4),
      keywords: list(o.keywords, 10, 40),
      prompt: cap(prompt, 2000),
      camera: camera || undefined,
      figure: figure || undefined,
      figureTreatment: figureTreatment || undefined,
      coverage: list(o.coverage, 2, 160),
    },
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * One short line, or nothing.
 *
 * Short on purpose: a figure phrase long enough to hold a pose would make every
 * generation the same photograph, which is the failure a scene exists to avoid.
 * Newlines are collapsed because this is spliced into a single prompt sentence,
 * and a `{placeholder}` drops the field rather than rejecting the whole draft -
 * the set may never name what is staged in it, but that is not worth a retry.
 */
function oneLine(v: unknown, max: number): string {
  const one = str(v).replace(/\s+/g, ' ');
  if (!one || /\{[^}]*\}/.test(one)) return '';
  return cap(one, max);
}
const cap = (v: string, max: number): string => (v.length > max ? v.slice(0, max).trim() : v);

function list(v: unknown, max: number, each: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => cap(str(x), each))
    .filter(Boolean)
    .slice(0, max);
}

/** Keep only values the filters already know, so a new asset lands somewhere findable. */
function pick(v: unknown, allowed: string[] | undefined, max: number): string[] {
  const raw = list(v, max * 2, 40);
  if (!allowed?.length) return raw.slice(0, max);
  const byLower = new Map(allowed.map((a) => [a.toLowerCase(), a]));
  const out: string[] = [];
  for (const candidate of raw) {
    const hit = byLower.get(candidate.toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out.slice(0, max);
}
