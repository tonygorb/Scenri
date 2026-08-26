#!/usr/bin/env -S npx tsx
/**
 * The Extend bake-off: five ways to grow a frame on an engine with no mask.
 *
 * Codex's image tool takes `{prompt, referenced_image_paths,
 * num_last_images_to_include}` and nothing else — no mask, no size, no seed —
 * so it cannot paint a margin and leave a photograph alone. It regenerates the
 * whole frame every time. The shipping route hands it a blurred 1.78x
 * magnification of the picture, asks it to "change only the blurred margin",
 * and then throws its answer's middle away and pastes the original back. That
 * paste is a hard opaque composite with no feather at any width, which is what
 * a viewer reads as a stitch.
 *
 * This measures whether that is actually the best available answer. Five arms
 * over one ratio, three repeats each, on six real shots from the real library:
 *
 *   A  today's bed  + today's margin prompt + today's paste     (the control)
 *   B  today's bed  + today's margin prompt + keep the answer   (isolates the paste)
 *   C  padded frame + reframe prompt        + keep the answer   (isolates the bed's lie)
 *   D  C + identity references                                  (isolates identity reinforcement)
 *   E  the source alone + reframe prompt    + keep the answer   (does the padding earn its place)
 *
 * Nothing here is a throwaway: `conditioningCanvas`, `reframeInstruction` and
 * `centralFidelity` are the shipping pieces, exercised through the same engine
 * adapter the product uses. The arms differ only in which of them is wired up.
 *
 *   pnpm exec tsx packages/cli/test/manual-extend-battery.mts
 *   ARMS=C,D SOURCES=clay,studio REPEATS=1 pnpm exec tsx packages/cli/test/manual-extend-battery.mts
 *
 * Real Codex runs cost real plan quota, so it is resumable: every finished run
 * is appended to ledger.jsonl and skipped on the next start. Failures are kept,
 * never curated away.
 */
import { mkdirSync, appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCodexEngine } from '@scenri/engine-codex';
import type { ReferenceRole } from '@scenri/core';
import { planExpand, expandInstruction, reframeInstruction, continueInstruction } from '../src/expandRules.js';
import { placeExpand, subjectFraction } from '../src/outpaint/place.js';
import { conditioningCanvas, type MarginFill } from '../src/outpaint/conditioning.js';
import { centralFidelity, centralRegion } from '../src/outpaint/fidelity.js';
import { chooseExpand, type PreservedCandidate } from '../src/outpaint/choose.js';
import { expandCanvas, compositeExpand, reframeExpand } from '../src/expand.js';
import { seamScore } from '../src/seamScore.js';
import { seamPenalty, seamResidual } from '../src/outpaint/score.js';

const HOME = process.env.SCENRI_HOME || join(homedir(), '.scenri');
const IMAGES = join(HOME, 'images');
const PREVIEWS = join(HOME, 'content', 'previews');
const OUT = process.env.BATTERY_OUT || join(homedir(), 'Desktop/scenri-project/scenri-ops/extend-bakeoff-2026-08-26');
const LEDGER = join(OUT, 'ledger.jsonl');
const CONCURRENCY = Number(process.env.BATTERY_CONCURRENCY || 3);

const img = (hash: string) => join(IMAGES, `${hash}.png`);
const product = (id: string, file: string) => join(PREVIEWS, 'demo-products', id, file);
const presenter = (id: string, file: string) => join(PREVIEWS, 'presenters', id, file);

interface Source {
  key: string;
  hash: string;
  what: string;
  /** Identity payload for arm D. Kept at two, well inside the five-image ceiling. */
  refs: Array<{ path: string; role: ReferenceRole }>;
}

/**
 * Six real shots, chosen for the ways an expansion fails rather than for looks:
 * a hard shadow on a coarse surface, a legible label, a person holding a
 * product, a printed logo, a face in near-darkness, and two objects that a
 * model is tempted to duplicate into new space.
 */
const SOURCES: Source[] = [
  {
    key: 'clay',
    hash: '95cc1059f656b6787e6cd2a97aff4871',
    what: 'amber dropper on cracked terracotta, hard low sun, long shadow, shallow DOF',
    refs: [{ path: product('aurelia-amber-serum', 'front.jpg'), role: 'product' }],
  },
  {
    key: 'studio',
    hash: '1aeb645b0e01b9f054a86019cf358672',
    what: 'Amber Serum hero on a polished pedestal, label square to camera',
    refs: [
      { path: product('aurelia-amber-serum', 'front.jpg'), role: 'product' },
      { path: product('aurelia-amber-serum', 'label.jpg'), role: 'product' },
    ],
  },
  {
    key: 'presenter',
    hash: '2746d33f7c3de9fe3c7eebb2433fe999',
    what: 'Mateo holding the yuzu soda at a table, mid conversation',
    refs: [
      { path: presenter('mateo', 'ref-01.jpg'), role: 'character' },
      { path: product('ferro-sons-yuzu-soda', 'front.jpg'), role: 'product' },
    ],
  },
  {
    key: 'logo',
    hash: 'd875bb00d54c357cffe52c77056dffe6',
    what: 'tech shell campaign frame with the brand logo printed on the chest',
    refs: [
      { path: product('slate-harbor-tech-shell', 'front.jpg'), role: 'product' },
      { path: img('cc2cf6468a3e13c793766ec6f5de3dd6'), role: 'brand' },
    ],
  },
  {
    key: 'lowkey',
    hash: '8d210bb36c2ae75201134e8ef64d7402',
    what: 'Itai, low key character study, face in near-darkness',
    refs: [{ path: presenter('itai', 'ref-01.jpg'), role: 'character' }],
  },
  {
    key: 'pair',
    hash: 'e5878de22a5a3b85f4445ecf3d89baeb',
    what: 'trail runners as a pair, one turned to show the outsole',
    refs: [
      { path: product('voss-rowe-trail-runner', 'lateral-side.jpg'), role: 'product' },
      { path: product('voss-rowe-trail-runner', 'three-quarter.jpg'), role: 'product' },
    ],
  },
];

type ArmId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'SHIP';
interface Arm {
  id: ArmId;
  what: string;
  input: 'bed' | 'padded' | 'source';
  fill?: MarginFill;
  prompt: 'margin' | 'reframe' | 'continue';
  assembly: 'paste' | 'keep' | 'choose';
  identity: boolean;
  /** State the axis that did not grow as a fact about the frame's edges. */
  anchor?: boolean;
}

const ARMS: Arm[] = [
  {
    id: 'A',
    what: 'control: bed + margin prompt + paste',
    input: 'bed',
    prompt: 'margin',
    assembly: 'paste',
    identity: false,
  },
  { id: 'B', what: 'no paste: bed + margin prompt', input: 'bed', prompt: 'margin', assembly: 'keep', identity: false },
  {
    id: 'C',
    what: 'reframe: padded frame + reframe prompt',
    input: 'padded',
    fill: 'edge',
    prompt: 'reframe',
    assembly: 'keep',
    identity: false,
  },
  {
    id: 'D',
    what: 'reframe + identity references',
    input: 'padded',
    fill: 'edge',
    prompt: 'reframe',
    assembly: 'keep',
    identity: true,
  },
  {
    id: 'E',
    what: 'no padding: source alone + reframe prompt',
    input: 'source',
    prompt: 'reframe',
    assembly: 'keep',
    identity: false,
  },
  /*
   * F and G exist because of what A-E measured, not instead of it. The bed arm
   * kept the photograph and the padded arm did not, and the two differ in the
   * verb as much as in the picture — so F pairs the padded frame, which tells
   * no lie about texture scale, with the preservation wording that the bed arm
   * had. G then asks whether the empty area reads better as nothing at all,
   * which is the convention OpenAI's own image documentation gives for
   * expanding a canvas with this model family.
   */
  {
    id: 'F',
    what: 'padded frame + preservation prompt',
    input: 'padded',
    fill: 'edge',
    prompt: 'continue',
    assembly: 'keep',
    identity: false,
  },
  /*
   * SHIP is not a candidate strategy. It is the pipeline as it actually runs:
   * both draws, both composited, ranked by the join, the photograph kept unless
   * neither composite can hide it. Stage 2 measures THIS across the ratios and
   * the shots the bake-off never reached, so what is reported is what a person
   * would get rather than what an arm scored.
   */
  {
    id: 'SHIP',
    what: 'the shipped decision: both draws, both composited, better join wins',
    input: 'bed',
    prompt: 'margin',
    assembly: 'choose',
    identity: false,
  },
  /*
   * H exists because every reframe arm failed the same way: the model widened
   * its field of view and shrank the subject to suit the new shape. F says
   * "keep the photograph unchanged", which is a request. H adds the geometry
   * that makes shrinking impossible to justify — the photograph's top and
   * bottom edges ARE the finished frame's top and bottom edges, because
   * planExpand kept every row and only added columns.
   */
  {
    id: 'H',
    what: 'padded frame + preservation prompt + unchanged-axis anchor',
    input: 'padded',
    fill: 'edge',
    prompt: 'continue',
    assembly: 'keep',
    identity: false,
    anchor: true,
  },
  {
    id: 'G',
    what: 'padded frame, transparent margin + preservation prompt',
    input: 'padded',
    fill: 'transparent',
    prompt: 'continue',
    assembly: 'keep',
    identity: false,
  },
];

const RATIOS: Record<string, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:5': 4 / 5,
  '5:4': 5 / 4,
  '1:1': 1,
};
const TARGET_LABEL = process.env.TARGET || '16:9';
if (!RATIOS[TARGET_LABEL]) throw new Error(`unknown TARGET ${TARGET_LABEL}; try ${Object.keys(RATIOS).join(', ')}`);
const TARGET = { label: TARGET_LABEL, ratio: RATIOS[TARGET_LABEL] };
const REPEATS = Number(process.env.REPEATS || 3);

// ---------------------------------------------------------------- engine

const store = new Map<string, Buffer>();
let saved = 0;
const engine = createCodexEngine({
  saveImage: (buf: Buffer) => {
    const id = `m${saved++}`;
    store.set(id, buf);
    return id;
  },
});

// ---------------------------------------------------------------- ledger

mkdirSync(join(OUT, 'out'), { recursive: true });
const done = new Set<string>();
if (existsSync(LEDGER)) {
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      // Only a SUCCESS is worth skipping. Codex times out on its own
      // occasionally — one run died to the 120s no-activity watchdog — and a
      // resumed battery that treated that as finished would quietly leave a
      // hole in the sample rather than filling it on the next pass.
      const row = JSON.parse(line);
      if (row.ok) done.add(row.key);
    } catch {
      /* a half-written line from a killed run is not a reason to stop */
    }
  }
}

interface RunRecord {
  key: string;
  /** Wall clock at completion, so throughput is measurable after the fact. */
  at?: string;
  arm: ArmId;
  source: string;
  target: string;
  repeat: number;
  ok: boolean;
  error?: string;
  ms: number;
  delivered?: [number, number];
  planned?: [number, number];
  /** How far the engine's own shape was from the shape it was asked for. */
  ratioError?: number;
  refit?: 'exact' | 'fill' | 'cover' | 'bed';
  fidelity?: { overall: number; luma: number; edges: number; colour: number; contrast: number };
  /** Only meaningful on the pasting arm: there is no join on the others. */
  seam?: number;
  /** What the shipped decision picked, and from which conditioning. */
  choice?: string;
}

const record = (r: RunRecord) => {
  appendFileSync(LEDGER, `${JSON.stringify(r)}\n`);
  const f = r.fidelity;
  const shape = r.delivered ? `${r.delivered[0]}x${r.delivered[1]}` : '-';
  console.log(
    r.ok
      ? `  ${r.key.padEnd(26)} fidelity ${f ? f.overall.toFixed(3) : '-'} ` +
          `(luma ${f?.luma.toFixed(2)} edge ${f?.edges.toFixed(2)} col ${f?.colour.toFixed(2)}) ` +
          `${shape} ${r.refit} ${(r.ms / 1000).toFixed(0)}s`
      : `  ${r.key.padEnd(26)} FAILED ${r.error} ${(r.ms / 1000).toFixed(0)}s`,
  );
};

// ---------------------------------------------------------------- one run

async function run(arm: Arm, source: Source, repeat: number): Promise<void> {
  const key = `${source.key}-${TARGET.label.replace(':', 'x')}-${arm.id}-r${repeat}`;
  if (done.has(key)) return;
  const started = Date.now();
  const base: RunRecord = { key, arm: arm.id, source: source.key, target: TARGET.label, repeat, ok: false, ms: 0 };

  try {
    const original = readFileSync(img(source.hash));
    const meta = await sharp(original).metadata();
    const size = { width: meta.width ?? 0, height: meta.height ?? 0 };
    let plan = planExpand(size, TARGET.ratio);
    if (!plan) throw new Error('nothing to grow');
    plan = placeExpand(plan, size, await subjectFraction(original, size, plan.axis));
    base.planned = [plan.width, plan.height];

    const conditioning =
      arm.input === 'bed'
        ? await expandCanvas(original, plan)
        : arm.input === 'padded'
          ? await conditioningCanvas(original, plan, arm.fill ?? 'edge')
          : original;
    const inputPath = join(OUT, 'out', `${key}-input.png`);
    writeFileSync(inputPath, conditioning);

    const instruction = arm.prompt === 'margin' ? expandInstruction(plan, '') : reframeInstruction(plan, size, '');
    const refs = arm.identity ? source.refs : [];

    /*
     * The shipped arm is not one request. It is the pair the server makes, both
     * composited and ranked, which is the only way to measure what a person
     * actually receives rather than what a strategy scores.
     */
    if (arm.assembly === 'choose') {
      const bedFrame = await expandCanvas(original, plan);
      const padFrame = await conditioningCanvas(original, plan, 'edge');
      const bedPath = join(OUT, 'out', `${key}-input-bed.png`);
      const padPath = join(OUT, 'out', `${key}-input-padded.png`);
      writeFileSync(bedPath, bedFrame);
      writeFileSync(padPath, padFrame);
      const [bedDraw, padDraw] = await Promise.allSettled([
        engine.edit({
          instruction: expandInstruction(plan, ''),
          sourceImage: bedPath,
          width: plan.width,
          height: plan.height,
        } as never),
        engine.edit({
          instruction: reframeInstruction(plan, size, ''),
          sourceImage: padPath,
          width: plan.width,
          height: plan.height,
        } as never),
      ]);
      const answerOf = (r: PromiseSettledResult<{ images: string[] }>) => {
        if (r.status !== 'fulfilled') return null;
        const h = r.value.images[0];
        return h ? (store.get(h) ?? null) : null;
      };
      const bedAnswer = answerOf(bedDraw);
      const padAnswer = answerOf(padDraw);
      if (!bedAnswer && !padAnswer) throw new Error('both draws failed');
      const preserved: PreservedCandidate[] = [];
      for (const [from, answer] of [
        ['bed', bedAnswer],
        ['padded', padAnswer],
      ] as const) {
        if (!answer) continue;
        const { image } = await compositeExpand(answer, original, plan);
        const [sc, res] = await Promise.all([seamScore(image, plan, size), seamResidual(image, plan, size)]);
        preserved.push({ image, seam: seamPenalty(sc, res), from });
      }
      const frame = padAnswer ? await reframeExpand(padAnswer, plan) : null;
      const decision = chooseExpand({ preserved, reframed: frame ? { image: frame } : null });
      if (!decision) throw new Error('no decision');
      writeFileSync(join(OUT, 'out', `${key}-final.png`), decision.image);
      writeFileSync(join(OUT, 'out', `${key}-crop.png`), await centralRegion(decision.image, plan, size));
      const got2 = await sharp(decision.image).metadata();
      base.delivered = [got2.width ?? 0, got2.height ?? 0];
      base.refit = decision.choice === 'preserved' ? 'exact' : 'fill';
      base.seam = decision.seam ?? undefined;
      base.choice = `${decision.choice}${decision.from ? `:${decision.from}` : ''}`;
      base.fidelity = await centralFidelity(decision.image, original, plan);
      base.ok = true;
      base.ms = Date.now() - started;
      base.at = new Date().toISOString();
      record(base);
      return;
    }

    const result = await engine.edit({
      instruction,
      sourceImage: inputPath,
      width: plan.width,
      height: plan.height,
      ...(refs.length ? { referenceImages: refs.map((r) => r.path), referenceRoles: refs.map((r) => r.role) } : {}),
    } as never);

    const first = result.images[0];
    const answer = first ? store.get(first) : undefined;
    if (!answer) throw new Error('engine returned no image');
    writeFileSync(join(OUT, 'out', `${key}-raw.png`), answer);

    const got = await sharp(answer).metadata();
    base.delivered = [got.width ?? 0, got.height ?? 0];
    const wantRatio = plan.width / plan.height;
    const gotRatio = (got.width ?? 1) / (got.height ?? 1);
    base.ratioError = Math.abs(gotRatio - wantRatio) / wantRatio;

    let final: Buffer;
    if (arm.assembly === 'paste') {
      const composited = await compositeExpand(answer, original, plan);
      final = composited.image;
      base.refit = composited.aligned ? 'exact' : 'bed';
      const [score, residual] = await Promise.all([seamScore(final, plan, size), seamResidual(final, plan, size)]);
      base.seam = seamPenalty(score, residual);
    } else {
      // Keep the engine's own frame. It is only ever resized to the planned
      // pixels, never recomposed: `fill` when the shape it chose already
      // matches, `cover` when it does not and something has to be given up.
      const exact = got.width === plan.width && got.height === plan.height;
      const fit = exact ? 'exact' : base.ratioError <= 0.02 ? 'fill' : 'cover';
      base.refit = fit;
      final = exact
        ? answer
        : await sharp(answer)
            .resize(plan.width, plan.height, { fit: fit === 'fill' ? 'fill' : 'cover', position: 'centre' })
            .png()
            .toBuffer();
    }
    writeFileSync(join(OUT, 'out', `${key}-final.png`), final);

    // The region the photograph occupied, lifted back out at the planned
    // geometry, so a human can judge the one comparison that matters: this
    // against the source, like for like, without the new area distracting.
    writeFileSync(join(OUT, 'out', `${key}-crop.png`), await centralRegion(final, plan, size));
    base.fidelity = await centralFidelity(final, original, plan);
    base.ok = true;
  } catch (err) {
    base.error = String((err as Error)?.message ?? err).slice(0, 300);
  }
  base.ms = Date.now() - started;
  base.at = new Date().toISOString();
  record(base);
}

// ---------------------------------------------------------------- pool

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------- main

const pick = <T extends { id?: string; key?: string }>(all: T[], env: string | undefined) => {
  if (!env) return all;
  const want = new Set(env.split(',').map((s) => s.trim()));
  return all.filter((x) => want.has(String(x.id ?? x.key)));
};

const arms = pick(ARMS, process.env.ARMS) as Arm[];
const sources = pick(SOURCES, process.env.SOURCES) as Source[];

const jobs: Array<{ arm: Arm; source: Source; repeat: number }> = [];
for (let repeat = 1; repeat <= REPEATS; repeat++) {
  for (const source of sources) {
    for (const arm of arms) jobs.push({ arm, source, repeat });
  }
}
const todo = jobs.filter(
  (j) => !done.has(`${j.source.key}-${TARGET.label.replace(':', 'x')}-${j.arm.id}-r${j.repeat}`),
);

const availability = await engine.isAvailable();
if (!availability.ok) {
  console.error(`codex is not available: ${availability.code ?? 'unknown'}`);
  process.exit(1);
}

console.log(`extend bake-off  ${TARGET.label}  arms ${arms.map((a) => a.id).join(',')}`);
for (const a of arms) console.log(`  ${a.id}  ${a.what}`);
console.log(`${jobs.length} runs planned, ${done.size} already in the ledger, ${todo.length} to go`);
console.log(`artifacts: ${OUT}\n`);

// Written before the first run, so the report can be built while the battery
// is still going and so a killed run still leaves a readable manifest behind.
writeFileSync(join(OUT, 'sources.json'), JSON.stringify({ SOURCES, ARMS, TARGET }, null, 2));

const t0 = Date.now();
await pool(todo, CONCURRENCY, ({ arm, source, repeat }) => run(arm, source, repeat));
console.log(`\ndone in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
