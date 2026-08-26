#!/usr/bin/env -S npx tsx
/**
 * Read the bake-off's artifacts back and score what the run itself could not.
 *
 * The driver measures fidelity — did the shot survive — and that is only half
 * the question. A run can preserve the photograph perfectly and still look
 * joined, because the model's own margin can meet the picture at a different
 * tone even when nothing was pasted. Arm B did exactly that on the first shot:
 * fidelity 1.000, and two visible vertical seams.
 *
 * So every arm gets the boundary measured, not just the one that composites.
 * `seamScore` and `seamResidual` do not care how a frame was assembled; they
 * look across the line where the source's edge fell and ask whether the step
 * there is bigger than the surface's own variation. That works on a coherent
 * generated frame exactly as well as on a pasted one.
 *
 * Nothing here spends Codex quota: it reads the PNGs the battery already wrote.
 *
 *   pnpm exec tsx packages/cli/test/manual-extend-report.mts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { planExpand } from '../src/expandRules.js';
import { placeExpand, subjectFraction } from '../src/outpaint/place.js';
import { seamScore } from '../src/seamScore.js';
import { seamPenalty, seamResidual } from '../src/outpaint/score.js';

const HOME = process.env.SCENRI_HOME || join(homedir(), '.scenri');
const OUT = process.env.BATTERY_OUT || join(homedir(), 'Desktop/scenri-project/scenri-ops/extend-bakeoff-2026-08-26');
const rows = readFileSync(join(OUT, 'ledger.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const { SOURCES, ARMS, TARGET } = JSON.parse(readFileSync(join(OUT, 'sources.json'), 'utf8'));
const sourceBy = new Map<string, { hash: string; what: string }>(
  SOURCES.map((s: { key: string; hash: string; what: string }) => [s.key, s]),
);

/** The same geometry the driver planned, recomputed rather than stored. */
const planCache = new Map<
  string,
  { plan: ReturnType<typeof planExpand>; size: { width: number; height: number }; original: Buffer }
>();
async function geometryFor(sourceKey: string) {
  const cached = planCache.get(sourceKey);
  if (cached) return cached;
  const src = sourceBy.get(sourceKey);
  if (!src) throw new Error(`unknown source ${sourceKey}`);
  const original = readFileSync(join(HOME, 'images', `${src.hash}.png`));
  const meta = await sharp(original).metadata();
  const size = { width: meta.width ?? 0, height: meta.height ?? 0 };
  let plan = planExpand(size, TARGET.ratio);
  if (!plan) throw new Error(`no plan for ${sourceKey}`);
  plan = placeExpand(plan, size, await subjectFraction(original, size, plan.axis));
  const entry = { plan, size, original };
  planCache.set(sourceKey, entry);
  return entry;
}

interface Scored {
  arm: string;
  source: string;
  repeat: number;
  ok: boolean;
  fidelity: number;
  luma: number;
  edges: number;
  colour: number;
  seam: number;
  ratioError: number;
  refit: string;
  ms: number;
}

const scored: Scored[] = [];
for (const r of rows) {
  if (!r.ok) {
    scored.push({
      arm: r.arm,
      source: r.source,
      repeat: r.repeat,
      ok: false,
      fidelity: 0,
      luma: 0,
      edges: 0,
      colour: 0,
      seam: Number.NaN,
      ratioError: r.ratioError ?? Number.NaN,
      refit: r.refit ?? '-',
      ms: r.ms,
    });
    continue;
  }
  const finalPath = join(OUT, 'out', `${r.key}-final.png`);
  let seam = Number.NaN;
  if (existsSync(finalPath)) {
    const { plan, size } = await geometryFor(r.source);
    if (plan) {
      const image = readFileSync(finalPath);
      const [s, resid] = await Promise.all([seamScore(image, plan, size), seamResidual(image, plan, size)]);
      seam = seamPenalty(s, resid);
    }
  }
  scored.push({
    arm: r.arm,
    source: r.source,
    repeat: r.repeat,
    ok: true,
    fidelity: r.fidelity.overall,
    luma: r.fidelity.luma,
    edges: r.fidelity.edges,
    colour: r.fidelity.colour,
    seam,
    ratioError: r.ratioError ?? Number.NaN,
    refit: r.refit ?? '-',
    ms: r.ms,
  });
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : Number.NaN);
const fmt = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '-');

const lines: string[] = [];
lines.push(`# Extend bake-off — ${TARGET.label}`, '');
lines.push(`${rows.length} runs, ${scored.filter((s) => s.ok).length} succeeded.`, '');
lines.push(
  'Two numbers decide this, and they pull against each other. **Fidelity** is how much of the',
  'shot survived a frame the model redrew whole (1.000 = indistinguishable from the source).',
  "**Seam** is how visible the boundary is where the source's edge fell, measured on the",
  'delivered frame regardless of how it was assembled — a pasted original and a coherent',
  'generation are both judged by whether the eye can find the join. Lower is better, and',
  'anything at or above 1.00 is a join a person can see.',
  '',
);

lines.push('## By arm', '');
lines.push('| Arm | What | n | Fidelity | Seam | Ratio err | Exact size | Mean s |');
lines.push('|---|---|---|---|---|---|---|---|');
for (const arm of ARMS as Array<{ id: string; what: string }>) {
  const mine = scored.filter((s) => s.arm === arm.id && s.ok);
  const exact = mine.filter((s) => s.refit === 'exact').length;
  lines.push(
    `| **${arm.id}** | ${arm.what} | ${mine.length} | ${fmt(mean(mine.map((s) => s.fidelity)))} | ` +
      `${fmt(mean(mine.map((s) => s.seam).filter(Number.isFinite)), 2)} | ` +
      `${fmt(mean(mine.map((s) => s.ratioError).filter(Number.isFinite)), 3)} | ` +
      `${exact}/${mine.length} | ${fmt(mean(mine.map((s) => s.ms)) / 1000, 0)} |`,
  );
}
lines.push('');

lines.push('## By arm and source', '');
const armIds = (ARMS as Array<{ id: string }>).map((a) => a.id);
lines.push(`| Source | ${armIds.map((a) => `${a} fid / seam`).join(' | ')} |`);
lines.push(`|---|${armIds.map(() => '---').join('|')}|`);
for (const s of SOURCES as Array<{ key: string; what: string }>) {
  const cells = armIds.map((a) => {
    const mine = scored.filter((x) => x.source === s.key && x.arm === a && x.ok);
    if (!mine.length) return '-';
    return `${fmt(mean(mine.map((x) => x.fidelity)), 2)} / ${fmt(mean(mine.map((x) => x.seam).filter(Number.isFinite)), 2)}`;
  });
  lines.push(`| \`${s.key}\` ${s.what} | ${cells.join(' | ')} |`);
}
lines.push('');

lines.push('## Every run', '');
lines.push('| Run | ok | Fidelity | luma | edge | colour | Seam | refit | s |');
lines.push('|---|---|---|---|---|---|---|---|---|');
for (const s of scored.sort((a, b) =>
  `${a.source}${a.arm}${a.repeat}`.localeCompare(`${b.source}${b.arm}${b.repeat}`),
)) {
  lines.push(
    `| ${s.source}-${s.arm}-r${s.repeat} | ${s.ok ? 'y' : 'FAIL'} | ${fmt(s.fidelity)} | ${fmt(s.luma, 2)} | ` +
      `${fmt(s.edges, 2)} | ${fmt(s.colour, 2)} | ${fmt(s.seam, 2)} | ${s.refit} | ${fmt(s.ms / 1000, 0)} |`,
  );
}

const failures = scored.filter((s) => !s.ok);
if (failures.length) {
  lines.push('', '## Failures kept', '');
  for (const f of failures) lines.push(`- ${f.source}-${f.arm}-r${f.repeat}`);
}

writeFileSync(join(OUT, 'report.md'), `${lines.join('\n')}\n`);
writeFileSync(join(OUT, 'scored.json'), JSON.stringify(scored, null, 2));
console.log(lines.slice(0, 40).join('\n'));
console.log(`\nwritten: ${join(OUT, 'report.md')}`);
