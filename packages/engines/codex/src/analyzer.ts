/**
 * Reference analysis: turns a person's own photos, or a pile of inspiration
 * images, into the structured record scenri's catalogs already use.
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
import { createRunner, execArgs, type RunnerOptions } from './run.js';

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
}

export interface CodexAnalyzer {
  isAvailable(): Promise<EngineAvailability>;
  analyze(req: AnalyzeRequest, signal?: AbortSignal): Promise<PresenterDraft | SceneDraft>;
}

export interface CodexAnalyzerOptions extends RunnerOptions {
  spawnImpl?: typeof nodeSpawn;
}

const OUT_FILE = 'analysis.json';

export function createCodexAnalyzer(opts: CodexAnalyzerOptions = {}): CodexAnalyzer {
  const runner = createRunner(opts);

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
          const args = execArgs(dir, buildPrompt(req, refs.length, problems), 'high');
          for (const ref of refs) {
            // --image is variadic; the = form binds exactly one value so the
            // positional prompt isn't swallowed as a second image path.
            args.splice(args.length - 1, 0, `--image=${ref}`);
          }
          await runner.run(args, signal);

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
  const body = req.kind === 'presenter' ? presenterBody(req, refCount) : sceneBody(req);
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

function sceneBody(req: AnalyzeRequest): string {
  const ask = req.instruction ? ` What the person wants from it: ${req.instruction}.` : '';
  const collections = req.vocabulary?.collections?.length
    ? ` Choose "collections" only from this list: ${req.vocabulary.collections.join(', ')}.`
    : '';
  const verticals = req.vocabulary?.verticals?.length
    ? ` Choose "verticals" only from this list: ${req.vocabulary.verticals.join(', ')}.`
    : '';
  return (
    `These are references for a place, not a picture to copy.${ask}` +
    ' Extract the reusable visual world behind them: environment, architecture, surfaces and materials, the character of the light, atmosphere, palette, depth, and the photographic language.' +
    ' Never name or describe a brand, a logo, a product, or a person. If a reference contains a bottle, a garment, a model or a mark, that thing is a visitor, not part of the world: leave it out completely, because something else will be staged here later.' +
    ' Describe where a photograph happens, not what is standing in it. Use no placeholders of any kind.' +
    ` ${OUT_FILE} must be a JSON object with exactly these keys:` +
    ' "name": two or three words a person would call this place, such as "Wet Basalt Shore";' +
    ' "promptName": the same place named for a generator, at most six words;' +
    ' "lighting": a short phrase naming the light, such as "Low directional sunset, long shadows across wet stone";' +
    ' "description": one sentence a person reads on a card;' +
    ' "subject": "product" if this world suits a staged object, "person" if it suits someone photographed in it, "either" when it truly suits both;' +
    ' "prompt": three or four sentences describing the set itself, in the present tense, naming nothing that is staged in it;' +
    ' "camera": the camera tendency of this world in a short phrase, or an empty string when it has none;' +
    ' "keywords": five to ten single words someone might search for;' +
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
    },
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
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
