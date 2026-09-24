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
  /**
   * File each attached photograph by the canonical view it could stand in
   * for. Asked only when the photographs are the user's own uploads and the
   * studio wants to know which views it need not draw.
   */
  classifyPhotos?: boolean;
}

/** Which canonical view a photograph could stand in for, and whether it is good enough to. */
export type PhotoView = 'portrait' | 'front' | 'three-quarter' | 'back' | 'left' | 'right' | 'other';
export const PHOTO_VIEWS: readonly PhotoView[] = [
  'portrait',
  'front',
  'three-quarter',
  'back',
  'left',
  'right',
  'other',
];
export interface PhotoFiling {
  /** Position in the attachment order: ref-1.png is 0. */
  index: number;
  view: PhotoView;
  usable: boolean;
  note: string;
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
  /**
   * The three prose fields a curated presenter carries and the compiler
   * reads: bone structure, skin, build. Optional, because a model that omits
   * them must not burn the one retry that exists for a broken contract.
   */
  facial?: string;
  skin?: string;
  build?: string;
  /** Present only when `classifyPhotos` was asked for and the answer had one. */
  photos?: PhotoFiling[];
  /**
   * One sentence, only when the photographs appear to show more than one
   * person. The studio shows it as a warning; nothing is refused on it.
   */
  conflict?: string;
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
  /**
   * What the reference pictures themselves show that a scene never keeps as it
   * is: a real person, a real product, readable words or marks. Not the scene's
   * words (those leave identity out already) but a note for the one draw that
   * sees the pictures: the scene's picture is drawn beside them, and anything
   * named here is then taken out of it (`sceneClearInstruction`). Absent
   * when the reader did not say, which is treated as "may hold all three".
   */
  holds?: SceneHold[];
}

export type SceneHold = 'person' | 'product' | 'lettering';
const HOLDS: readonly SceneHold[] = ['person', 'product', 'lettering'];

/** One product photograph, read for how large the real object is. */
export interface MeasureRequest {
  /** Absolute path to the product's first photograph. */
  imagePath: string;
  /** What the product is called, so a name like "Travel Mug" can help. */
  name: string;
  /** The record's own words about it, when it has any. */
  description?: string;
}

/** A product's real size, as a person would say it and as a number. */
export interface SizeRead {
  /** In plain words with a unit, e.g. "about 2 cm across". */
  text: string;
  /** Its largest dimension as it stands, in centimetres. */
  largestCm: number;
}

export interface CodexAnalyzer {
  isAvailable(): Promise<EngineAvailability>;
  analyze(req: AnalyzeRequest, signal?: AbortSignal): Promise<PresenterDraft | SceneDraft>;
  measure(req: MeasureRequest, signal?: AbortSignal): Promise<SizeRead>;
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

    /*
     * How large the real object is. A packshot fills its own frame whatever
     * the product, so the photograph says what the object is and never how
     * large; the size is worked out from what it is. Read once per product
     * and kept (productScale.ts is why it matters).
     */
    async measure(req: MeasureRequest, signal?: AbortSignal): Promise<SizeRead> {
      return runner.withWorkDir(async (dir) => {
        const ref = join(dir, 'ref-1.png');
        await copyFile(req.imagePath, ref);
        let problems: string[] = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          const args = execArgs(dir, 'high');
          args.splice(args.length - 1, 0, `--image=${ref}`);
          await runner.run(args, signal, {
            stdin: measurePrompt(req, problems),
            label: `measure attempt=${attempt + 1}`,
          });
          let raw: string;
          try {
            raw = await readFile(join(dir, OUT_FILE), 'utf8');
          } catch {
            problems = [`No ${OUT_FILE} was written.`];
            continue;
          }
          const parsed = parseSize(raw);
          if (parsed.ok) return parsed.size;
          problems = parsed.problems;
        }
        throw new Error(`Codex could not size this product: ${problems.join(' ')}`);
      });
    },
  };
}

function measurePrompt(req: MeasureRequest, problems: string[]): string {
  const about = req.description ? ` Its maker describes it: ${req.description}.` : '';
  const retry = problems.length
    ? ` Your last answer was rejected: ${problems.join(' ')} Fix exactly that and write the file again.`
    : '';
  return (
    `One photograph of a product is attached; the product is called "${req.name}".${about}` +
    ' Say how large the real object is, the way a shop lists it. Work it out from what the object is, its parts and' +
    ' their proportions, never from how large it looks in this picture: a product photograph fills its frame whatever' +
    ' the product. Measure it as it stands or lies in a photograph, not folded, worn or packed.' +
    ` ${OUT_FILE} must be a JSON object with exactly these keys:` +
    ' "size": its size in plain words with a unit, about the one or two dimensions a person would picture, such as' +
    ' "about 2 cm across", "about 10 cm tall", "about 30 cm long" or "about 45 by 35 cm";' +
    ' "largestCm": its largest dimension as it stands, in centimetres, as a number.' +
    ` Write strict JSON, and nothing but JSON, to a file called ${OUT_FILE} in the current directory` +
    ' (you may run the commands needed to write it). Do not browse the web or explore files.' +
    ` No prose, no markdown fences, no commentary.${retry}`
  );
}

function parseSize(raw: string): { ok: true; size: SizeRead } | { ok: false; problems: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { ok: false, problems: [`${OUT_FILE} was not valid JSON (${(err as Error).message}).`] };
  }
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const text = cap(str(o.size), 80);
  const largest = Number(o.largestCm);
  const problems: string[] = [];
  if (!text || !/\d/.test(text)) problems.push('"size" must be plain words with a number and a unit.');
  // A thumb tack to a wardrobe: anything outside is a misread, not a product.
  if (!Number.isFinite(largest) || largest < 0.3 || largest > 400)
    problems.push('"largestCm" must be a number of centimetres between 0.3 and 400.');
  if (problems.length) return { ok: false, problems };
  return { ok: true, size: { text, largestCm: Math.round(largest * 10) / 10 } };
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
    ' "identityNotes": one paragraph naming the two or three features that must survive every generation, drawn from face shape, eyes, nose, mouth, jaw, skin, distinctive marks, and build where it is visible.' +
    // A mark with no side comes back on either arm: "a floral tattoo on one
    // shoulder" drew it on the wrong arm in 2 of 4 shots (2026-09-24).
    " Name every tattoo, scar, birthmark, piercing and anything they always wear, such as glasses, by what it is, exactly where it sits and which side, as the person's own left or right;" +
    ' "negativeConstraints": an array of short refusals for the drift these photographs invite, such as "no youth-smoothing that erases the natural lines";' +
    ` "suitableCategories": the industries this person would be cast for.${categories}` +
    ' "coverage": an array of at most two short sentences naming a view that is missing and would make this person more consistent, such as "A three-quarter photo would pin the cheekbones down." Use an empty array when the coverage is already good;' +
    ' "facial": bone structure in words, the face shape, jaw, cheekbones, eyes and brows a photographer would need to recognise them again;' +
    ' "skin": their skin tone and texture exactly as the photographs show it, never smoothed;' +
    ' "build": their body type and proportions where the photographs show them.' +
    (req.classifyPhotos ? photosClause(refCount) : '')
  );
}

/** The filing the studio asks for on the user's own uploads, so it knows which views it need not draw. */
function photosClause(refCount: number): string {
  return (
    ` Also write "photos": an array with one entry per attached image in attachment order (ref-1.png is index 0, up to index ${Math.max(0, refCount - 1)}),` +
    ' each an object {"index", "view", "usable", "note"}, where "view" is exactly one of' +
    ' "portrait" (head and shoulders, the face large and facing the camera),' +
    ' "front" (full length, standing, facing the camera),' +
    ' "three-quarter" (turned about forty-five degrees, both eyes visible),' +
    ' "back" (full length, facing away from the camera),' +
    ' "left" (full length, the left side of the body to the camera),' +
    ' "right" (full length, the right side of the body to the camera),' +
    ' or "other"; "usable" is true only when the image is sharp, evenly lit, unobstructed, and shows this person clearly enough to stand in as that view; "note" is a few words on why.' +
    ' If the photographs appear to show more than one person, also write "conflict": one sentence saying which images disagree; otherwise leave "conflict" out.'
  );
}

function sceneBody(req: AnalyzeRequest, refCount: number): string {
  // The user's own direction, and it outranks the pictures.
  //
  // This used to read "What the person wants from it: X" - a wish, with no
  // authority to settle anything. With one reference the pictures are often
  // ambiguous about what is the concept and what merely happened to be in the
  // frame, and the person who chose them is the only one who knows.
  //
  // With no pictures the same clause was a lie: it talked about references
  // that were not there, and framed the only sentence the person wrote as a
  // footnote to them. Words alone are the brief.
  const ask = req.instruction
    ? refCount === 0
      ? ` The person describes the place as: ${req.instruction}.` +
        ' That description is the brief: expand it into a complete reusable world, keeping every decision it already made and inventing nothing that contradicts it.'
      : ` The person who chose these references says what matters in them: ${req.instruction}.` +
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
    // A bare "saturated green" came back deep bottle green for a bright leaf
    // green set (battery 2026-09-23): the vibe is the colour's strength too.
    ' Give each dominant colour the way a painter would, its hue, how light it is and how saturated -' +
    ' "bright saturated leaf green", "deep bottle green", "pale chalky mint" - never a bare colour name.' +
    ' Say so when a surface is reflective or transmissive: a mirror, a wet floor, chrome, glass, still water.' +
    ' Those govern how everything in the frame is lit, and they are the first thing lost to a generic description.' +
    // Lettering described without its words, then forbidden by the draw,
    // left the image model to settle the contradiction off the attached
    // pictures (battery 2026-09-23): it copied the reference's own words,
    // brand names included, invented ad copy, drew scribble, or dropped the
    // lettering that was the whole idea. The treatment doctrine found the same
    // thing first (briefDirectives): the answer is designed words that belong
    // to nobody, and none at all for what was only ever the advertisement.
    ' Lettering plays one of two roles, and only one of them belongs to the world.' +
    ' Lettering built, printed, painted or carved into the set - sculptural letters, signage, a lettered wall or floor, printed tape,' +
    ' a giant painted word used as scenery - is art direction: say what it is made of, its scale, placement and typographic style,' +
    ' and give it new words of your own in curly quotation marks, “like this”: two to four short generic words that suit the mood,' +
    ' never the words it carries in the reference and never a name.' +
    ' Lettering laid over the picture - a headline, tagline, caption, credits, price, hashtag, handle, date, interface or watermark -' +
    ' is the advertisement, not the world: leave it out and do not mention it.' +
    ' A logo is never reproduced: where a mark is a large graphic element of the set, keep only its colour, scale and gesture' +
    ' as an original motif with no letters in it.' +
    // The correction this prompt exists to make. "Leave it out completely" was
    // read, correctly, as an instruction to describe an empty room.
    ' What you leave out is identity, not presence.' +
    ' Never name a brand, a product model or a wordmark, and do not use any proper name anywhere in your answer.' +
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
    // Its shadow and reflection go with it: a row of shadows left behind by
    // bottles that were taken away drew as shadows cast by nothing.
    ' A product, garment or mark staged in a reference is a visitor: leave the object itself out, with its shadow and its reflection,' +
    ' but keep what it tells you about the place - the surface it sat on, the scale it implies, how densely the space is dressed.' +
    ' Nor does a figure carry one: describe their pose with empty hands, never as holding, offering, wearing or using it.' +
    // "The world is what they share" collapsed complementary references to
    // their intersection: a stone set, a striped light and sculptural letters
    // came back as stone alone, and the order of the pictures made no
    // difference to it (battery 2026-09-23). They were chosen together.
    ' Where several references are attached, they were chosen together to describe one world.' +
    ' Build it from what they share, then add what each one brings that the others do not contradict -' +
    ' a material, a light, a colour, a graphic device, a piece of lettering - until the world holds all of it:' +
    ' a detail is not a visitor because only one reference shows it.' +
    ' Where they truly disagree - two different places, or two palettes or lights that cannot share one frame -' +
    ' follow the place most of them support, or else the one that shows the most of a place, and never blend them into something none of them is;' +
    ' say in "coverage" what you left out.' +
    ' Use no placeholders of any kind.' +
    ` ${OUT_FILE} must be a JSON object with exactly these keys:` +
    ' "name": two or three words a person would call this place, such as "Wet Basalt Shore";' +
    ' "promptName": the same place named for a generator, at most six words;' +
    ' "lighting": a short phrase naming the light, such as "Low directional sunset, long shadows across wet stone";' +
    ' "description": one sentence a person reads on a card;' +
    ' "subject": "product" if this world suits a staged object, "person" if it suits someone photographed in it, "either" when it truly suits both;' +
    ' "prompt": four or five sentences describing the set itself, in the present tense, naming nothing branded and nobody identifiable.' +
    ' Ambient human presence belongs here, written the way the rest of the set is written - a figure far off in the frame, worn seats, a table dressed for two;' +
    ' "figure": when this concept depends on a person being in it, one short phrase for the role they play -' +
    ' their framing, their scale, and what they are doing - such as "someone is seated at the stone ledge, mid-ground, at human scale"' +
    ' or "one person at close portrait range, squared to camera, filling the frame".' +
    ' A portrait counts. If the reference is built around a person and would stop being this concept without one, that is a figure,' +
    ' however much of the frame they occupy. Use an empty string only when the concept genuinely survives with nobody in it,' +
    ' or when the people present are passers-by rather than the point - describe those in "prompt" with the rest of the set instead.' +
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
    ' "holds": an array naming what the reference pictures themselves show, from exactly these words:' +
    ' "person" if any real person, face or body part appears in any of them, however small;' +
    ' "product" if any product, package, garment or object is staged or held as the thing being shown;' +
    ' "lettering" if any readable words, logo or brand mark appears anywhere.' +
    ' An empty array when none of these appear, and an empty array when no reference image is attached;' +
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
      // Cut at a clause, never mid-word: every shot of a person is told these,
      // and a hard slice sent "full-body proporti." with each one.
      hair: oneLine(o.hair, 120),
      identityNotes: cap(identityNotes, 900),
      negativeConstraints: list(o.negativeConstraints, 6, 160),
      suitableCategories: pick(o.suitableCategories, req.vocabulary?.categories, 6),
      coverage: sentences(o.coverage, 2, 240),
      // Non-blocking, like scene's `camera`: a model that omits or fumbles
      // these must not burn the single retry that exists for a broken contract.
      ...optional('facial', oneLine(o.facial, 300)),
      ...optional('skin', oneLine(o.skin, 200)),
      ...optional('build', oneLine(o.build, 200)),
      ...(req.classifyPhotos ? optional('photos', photoFilings(o.photos, req.imagePaths.length)) : {}),
      ...(req.classifyPhotos ? optional('conflict', cap(str(o.conflict), 200)) : {}),
    },
  };
}

/** A key only when there is a value, so an absent answer stays absent rather than empty. */
function optional<K extends string, V>(key: K, value: V | '' | undefined): Partial<Record<K, V>> {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
    ? {}
    : ({ [key]: value } as Record<K, V>);
}

/** The photo filing, tolerated into shape: bad rows dropped, unknown views "other", loose booleans coerced. */
function photoFilings(raw: unknown, count: number): PhotoFiling[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PhotoFiling[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const index = Number(r.index);
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    const view = (PHOTO_VIEWS as readonly string[]).includes(str(r.view).toLowerCase())
      ? (str(r.view).toLowerCase() as PhotoView)
      : 'other';
    const usable = r.usable === true || /^(true|yes)$/i.test(str(r.usable));
    out.push({ index, view, usable, note: cap(str(r.note), 160) });
  }
  return out.length ? out : undefined;
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
  const figure = oneLine(o.figure, 160);
  // A treatment without a figure describes nothing, so it never survives alone.
  // Longer than the figure's role, because the treatment's detail is the point.
  const figureTreatment = figure ? oneLine(o.figureTreatment, 240) : '';
  // Non-blocking too. Unreadable means unknown, never "holds nothing": an
  // unknown picture is scrubbed, a known-clean one is not.
  const holds = Array.isArray(o.holds)
    ? HOLDS.filter((h) => (o.holds as unknown[]).some((x) => str(x).toLowerCase() === h))
    : undefined;
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
      coverage: sentences(o.coverage, 2, 240),
      ...(holds ? { holds } : {}),
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
  if (one.length <= max) return one;
  // Cut at the last clause, else the last whole word, never mid-word: nine
  // readings in a battery of forty reached the draw as "limbs spre" and "a
  // dispensing gestur", and the clause that ran over was the pose around a
  // product ("arms gathered around a precarious stack").
  const cut = one.slice(0, max);
  const clause = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(';'));
  if (clause > max / 2) return cut.slice(0, clause).trim();
  return (/\s/.test(one[max] ?? '') ? cut : cut.replace(/\s+\S*$/, '')).replace(/[\s,;:-]+$/, '');
}
const cap = (v: string, max: number): string => (v.length > max ? v.slice(0, max).trim() : v);

/**
 * Sentences a person reads in the conversation, cut the way `oneLine` cuts: a
 * coverage note clipped at 160 characters mid-word used to reach the screen as
 * "their shared world is chiefly directional light an".
 */
function sentences(v: unknown, max: number, each: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => oneLine(x, each))
    .filter(Boolean)
    .slice(0, max);
}

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
