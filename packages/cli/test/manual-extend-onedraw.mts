#!/usr/bin/env -S npx tsx
/**
 * Can one draw serve both candidates?
 *
 * The rule that shipped needs two things in hand: an answer the original can be
 * composited back over, and an answer that stands on its own. It asks for both,
 * because compositing is known to work on a bed-conditioned answer and had
 * never been measured on a padded-conditioned one. If it works there too, an
 * extend costs one draw rather than two — half the quota, half the latency.
 *
 * This spends no quota. The padded answers were drawn during the bake-off and
 * kept; this composites the original back over them and measures the join.
 *
 *   pnpm exec tsx packages/cli/test/manual-extend-onedraw.mts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { planExpand } from '../src/expandRules.js';
import { placeExpand, subjectFraction } from '../src/outpaint/place.js';
import { compositeExpand } from '../src/expand.js';
import { seamScore } from '../src/seamScore.js';
import { seamPenalty, seamResidual } from '../src/outpaint/score.js';
import { centralFidelity } from '../src/outpaint/fidelity.js';

const HOME = process.env.SCENRI_HOME || join(homedir(), '.scenri');
const OUT = process.env.BATTERY_OUT || join(homedir(), 'Desktop/scenri-project/scenri-ops/extend-bakeoff-2026-08-26');
const { SOURCES, TARGET } = JSON.parse(readFileSync(join(OUT, 'sources.json'), 'utf8'));
const rows = readFileSync(join(OUT, 'ledger.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))
  .filter((r) => r.ok);

/** The arms whose answer was drawn from a padded frame rather than the bed. */
const PADDED = new Set(['C', 'D', 'F', 'G', 'H']);
const mean = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : Number.NaN);
const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '-');

const geo = new Map<
  string,
  { plan: NonNullable<ReturnType<typeof planExpand>>; size: { width: number; height: number }; original: Buffer }
>();
async function geometryFor(key: string) {
  const hit = geo.get(key);
  if (hit) return hit;
  const src = (SOURCES as Array<{ key: string; hash: string }>).find((s) => s.key === key);
  if (!src) throw new Error(`unknown source ${key}`);
  const original = readFileSync(join(HOME, 'images', `${src.hash}.png`));
  const meta = await sharp(original).metadata();
  const size = { width: meta.width ?? 0, height: meta.height ?? 0 };
  let plan = planExpand(size, TARGET.ratio);
  if (!plan) throw new Error(`no plan for ${key}`);
  plan = placeExpand(plan, size, await subjectFraction(original, size, plan.axis));
  const entry = { plan, size, original };
  geo.set(key, entry);
  return entry;
}

interface Row {
  source: string;
  arm: string;
  repeat: number;
  bedPasteSeam: number | null;
  paddedPasteSeam: number;
  paddedKeepFidelity: number;
}

const bedSeamBySource = new Map<string, number[]>();
for (const r of rows) {
  if (r.arm === 'A' && typeof r.seam === 'number') {
    bedSeamBySource.set(r.source, [...(bedSeamBySource.get(r.source) ?? []), r.seam]);
  }
}

const out: Row[] = [];
for (const r of rows) {
  if (!PADDED.has(r.arm)) continue;
  const raw = join(OUT, 'out', `${r.key}-raw.png`);
  if (!existsSync(raw)) continue;
  const { plan, size, original } = await geometryFor(r.source);
  const { image } = await compositeExpand(readFileSync(raw), original, plan);
  const [s, resid] = await Promise.all([seamScore(image, plan, size), seamResidual(image, plan, size)]);
  out.push({
    source: r.source,
    arm: r.arm,
    repeat: r.repeat,
    bedPasteSeam: mean(bedSeamBySource.get(r.source) ?? []),
    paddedPasteSeam: seamPenalty(s, resid),
    paddedKeepFidelity: r.fidelity.overall,
  });
}

const lines: string[] = [];
lines.push('# One draw or two?', '');
lines.push(
  'The shipped rule needs a compositable answer and a coherent one. It asks for',
  'two draws because compositing was only ever measured on a bed-conditioned',
  'answer. This composites the original back over the PADDED answers already on',
  'disk and measures the same join. No quota was spent.',
  '',
  'If the padded answer takes a paste as cleanly as the bed answer does, one draw',
  'serves both candidates and an extend costs half of what it costs today.',
  '',
);
lines.push('| Source | bed answer + paste | padded answer + paste | padded answer kept (fidelity) |');
lines.push('|---|---|---|---|');
const bySource = new Map<string, Row[]>();
for (const r of out) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
for (const [src, rs] of bySource) {
  lines.push(
    `| \`${src}\` | ${fmt(rs[0].bedPasteSeam ?? Number.NaN)} | ${fmt(mean(rs.map((x) => x.paddedPasteSeam)))} | ${fmt(mean(rs.map((x) => x.paddedKeepFidelity)))} |`,
  );
}
const bedAll = [...bedSeamBySource.values()].flat();
lines.push('');
lines.push(
  `Overall: bed + paste **${fmt(mean(bedAll))}**, padded + paste **${fmt(mean(out.map((r) => r.paddedPasteSeam)))}**, ` +
    `over ${out.length} padded answers and ${bedAll.length} bed answers. Visible threshold is 2.2.`,
);
writeFileSync(join(OUT, 'one-draw.md'), `${lines.join('\n')}\n`);
writeFileSync(join(OUT, 'one-draw.json'), JSON.stringify(out, null, 2));
console.log(lines.join('\n'));
