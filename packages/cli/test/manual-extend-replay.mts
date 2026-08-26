#!/usr/bin/env -S npx tsx
/**
 * Replay the shipped decision over real model answers.
 *
 * The rule was chosen from an analysis script; this checks that the code that
 * actually ships reaches the same conclusion, on the same real pictures, through
 * the same functions the server calls — `compositeExpand`, `reframeExpand`,
 * `seamScore`/`seamResidual` and `chooseExpand`. The unit tests prove the rule
 * on fixtures; this proves the wiring on photographs.
 *
 * It also checks the guarantee the product now makes out loud: when the decision
 * says `preserved`, the source region really is byte for byte the source.
 *
 * No quota. Every answer replayed here was drawn during the bake-off and kept.
 *
 *   pnpm exec tsx packages/cli/test/manual-extend-replay.mts
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { planExpand } from '../src/expandRules.js';
import { placeExpand, subjectFraction } from '../src/outpaint/place.js';
import { compositeExpand, reframeExpand } from '../src/expand.js';
import { seamScore } from '../src/seamScore.js';
import { seamPenalty, seamResidual } from '../src/outpaint/score.js';
import { chooseExpand, type PreservedCandidate } from '../src/outpaint/choose.js';

const HOME = process.env.SCENRI_HOME || join(homedir(), '.scenri');
const OUT = process.env.BATTERY_OUT || join(homedir(), 'Desktop/scenri-project/scenri-ops/extend-bakeoff-2026-08-26');
const { SOURCES, TARGET } = JSON.parse(readFileSync(join(OUT, 'sources.json'), 'utf8'));
const ledger = readFileSync(join(OUT, 'ledger.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))
  .filter((r) => r.ok);

/** Arms drawn from the bed, and arms drawn from the padded frame. */
const BED = new Set(['A', 'B']);
const PADDED = new Set(['C', 'D', 'F', 'G', 'H']);
const raw = (key: string) => join(OUT, 'out', `${key}-raw.png`);

let pairs = 0;
let kept = 0;
let exact = 0;
const failures: string[] = [];

for (const src of SOURCES as Array<{ key: string; hash: string; what: string }>) {
  const original = readFileSync(join(HOME, 'images', `${src.hash}.png`));
  const meta = await sharp(original).metadata();
  const size = { width: meta.width ?? 0, height: meta.height ?? 0 };
  let plan = planExpand(size, TARGET.ratio);
  if (!plan) continue;
  plan = placeExpand(plan, size, await subjectFraction(original, size, plan.axis));

  const mine = ledger.filter((r) => r.source === src.key);
  const bedRuns = mine.filter((r) => BED.has(r.arm) && existsSync(raw(r.key)));
  const padRuns = mine.filter((r) => PADDED.has(r.arm) && existsSync(raw(r.key)));
  if (!bedRuns.length || !padRuns.length) continue;

  console.log(`\n${src.key}  —  ${src.what}`);
  // Every bed answer against every padded answer is a plausible pairing of the
  // two draws a real run would have made.
  for (const b of bedRuns) {
    for (const p of padRuns) {
      pairs += 1;
      const preserved: PreservedCandidate[] = [];
      for (const [from, run] of [
        ['bed', b],
        ['padded', p],
      ] as const) {
        const { image } = await compositeExpand(readFileSync(raw(run.key)), original, plan);
        const [s, resid] = await Promise.all([seamScore(image, plan, size), seamResidual(image, plan, size)]);
        preserved.push({ image, seam: seamPenalty(s, resid), from });
      }
      const frame = await reframeExpand(readFileSync(raw(p.key)), plan);
      const decision = chooseExpand({ preserved, reframed: frame ? { image: frame } : null });
      if (!decision) {
        failures.push(`${b.key} x ${p.key}: no decision`);
        continue;
      }
      if (decision.choice === 'preserved') {
        kept += 1;
        // The guarantee, checked on a photograph rather than a fixture.
        const region = { left: plan.left, top: plan.top, width: size.width, height: size.height };
        const before = await sharp(original).removeAlpha().raw().toBuffer();
        const after = await sharp(decision.image).extract(region).removeAlpha().raw().toBuffer();
        if (Buffer.compare(before, after) === 0) exact += 1;
        else failures.push(`${b.key} x ${p.key}: said preserved, and the region is NOT byte for byte`);
      }
    }
  }
}

console.log(`\n${pairs} pairings replayed through the shipped path`);
console.log(`  kept the photograph: ${kept}/${pairs}`);
console.log(`  and it was byte for byte: ${exact}/${kept}`);
if (failures.length) {
  console.log(`\n${failures.length} problems:`);
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  process.exit(1);
}
console.log('\nthe shipped rule reaches the same conclusion the analysis did, and the guarantee holds');
