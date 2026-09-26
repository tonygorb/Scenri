import { describe, expect, it } from 'vitest';
import type { SceneStudioJob } from '../src/apiTypes.js';
import type { Turn } from '../src/conversation/question.js';
import { coverageLine } from '../src/create/presenter/presenterStudioRules.js';
import { stoppedOrFailed } from '../src/create/presenter/presenterRecordTurns.js';
import { type FlowArgs, type SetArgs, turnsFor } from '../src/create/scene/sceneFlowRules.js';
import { type Answers, EMPTY_SETUP } from '../src/create/scene/sceneSetup.js';
import { EMPTY, reduce, type StudioState } from '../src/create/scene/sceneStudioRules.js';
import { describeFailure } from '../src/failure.js';

/**
 * What the presenter and scene conversations say when a provider refuses. Every
 * raw string is one the engines really throw, copied from the place that throws
 * it (failure.test.ts keeps the same list).
 *
 * Both conversations read a failure the way the composer does, through
 * `describeFailure`: what happened in words, the control that fixes it before
 * Retry, and never Retry alone for a failure that can only repeat itself.
 */
const REAL: Record<string, string> = {
  codexAuthMidJob: 'codex exited with code 1: ERROR: unexpected status 401 Unauthorized',
  openrouter401:
    'OpenRouter request failed: HTTP 401: {"error":{"message":"Missing Authentication header","code":401}}',
  codexUsageLimit:
    "Your Codex plan's usage limit is used up until Aug 30th, 2026 12:41 AM. Generation resumes on its own then, or add credits from your Codex account.",
  spendCap: 'Spend cap for openrouter: $10.00/mo. Spent $9.80, next ~$0.40 would exceed it.',
  rate: 'OpenRouter request failed: HTTP 429: {"error":{"message":"Rate limit exceeded","code":429}}',
  malformed: 'OpenRouter returned non-JSON body (HTTP 200): <html><body>Bad gateway</body></html>',
  codexExit: 'codex exited with code 1: ERROR: code-mode host exited during handshake',
};

/** Protocol, exit codes and JSON envelopes: the engine's words for an engineer. */
const RAW = /codex exited with code|HTTP \d{3}|\{"error"|ERROR:|non-JSON body/;

/** What is wrong with one question, for one failure class; empty when nothing is. */
function faults(name: string, raw: string, prompt: string, options: string[]): string[] {
  const out: string[] = [];
  if (RAW.test(prompt)) out.push(`${name}: quotes the engine: "${prompt}"`);
  if (!describeFailure(raw).retryable && options.join() === 'retry')
    out.push(`${name}: offers only Retry for a failure describeFailure calls not retryable`);
  return out;
}

describe('the presenter conversation reads a provider failure', () => {
  it('says a failed view in words, and never offers Retry alone where retrying cannot help (FAIL-X6)', () => {
    const found: string[] = [];
    for (const [name, raw] of Object.entries(REAL)) {
      const q = stoppedOrFailed('portrait', raw);
      found.push(...faults(name, raw, q.prompt, q.kind === 'confirm' ? q.options.map((o) => o.id) : []));
    }
    expect(found).toEqual([]);
  });

  it('says a photo read that failed in words (FAIL-X6)', () => {
    const line = coverageLine({ source: 'photos', stage: 'idle', readError: REAL.codexAuthMidJob } as any, true);
    expect(line?.text ?? '').not.toMatch(RAW);
  });
});

const H = (c: string) => c.repeat(32);
const guided: Answers = {
  source: { door: 'guided' },
  world: { pick: 'stone' },
  surface: { pick: 'stone-travertine' },
  light: { pick: 'stone-golden' },
  signature: { pick: 'stone-vines' },
};
const args = (studio: StudioState, over: Partial<FlowArgs> = {}): FlowArgs => ({
  setup: { ...EMPTY_SETUP, answers: guided },
  studio,
  canDraw: true,
  uploading: 0,
  edit: null,
  editingName: false,
  ...over,
});
const job = (over: Partial<SceneStudioJob>): SceneStudioJob =>
  ({
    id: 'j1',
    brandId: 'b',
    kind: 'make',
    status: 'failed',
    phase: null,
    startedAt: 't',
    phaseAt: 't',
    finishedAt: 't',
    reading: null,
    coverage: [],
    hash: null,
    error: null,
    warnings: [],
    attachTo: null,
    ...over,
  }) as SceneStudioJob;
const finished = (over: Partial<SceneStudioJob>) =>
  [
    { type: 'inputs', place: 'x', pictures: [] },
    { type: 'started', id: 'j1', kind: 'make', since: 't' },
    { type: 'finished', job: job(over) },
  ].reduce((s, a) => reduce(s, a as any), EMPTY);
const lastQ = (T: Turn[]) => {
  const t = T[T.length - 1];
  return t?.kind === 'question' ? t.question : null;
};

describe('the scene conversation reads a provider failure', () => {
  it('says a failed read or draw in words, and never offers Retry alone where retrying cannot help (FAIL-X7)', () => {
    const found: string[] = [];
    for (const [name, raw] of Object.entries(REAL)) {
      const q = lastQ(turnsFor(args(finished({ error: raw }))));
      if (!q) {
        found.push(`${name}: no question`);
        continue;
      }
      found.push(...faults(name, raw, q.prompt, q.kind === 'confirm' ? q.options.map((o) => o.id) : []));
    }
    expect(found).toEqual([]);
  });

  it('says an example that failed in words (FAIL-X7)', () => {
    let studio = finished({
      status: 'done',
      reading: { name: 'Shelf', prompt: 'A shelf.', lighting: 'Soft', subject: 'product', description: 'A shelf.' },
      hash: H('a'),
    });
    studio = reduce(studio, { type: 'name', text: 'Tide Shelf' } as any);
    studio = reduce(studio, { type: 'saved', id: 'us-1' } as any);
    studio = reduce(studio, { type: 'set-drawn' } as any);
    const set: SetArgs = {
      tiles: [
        { role: 'hero', state: 'shown', hash: H('b'), url: `/api/images/${H('b')}` },
        { role: 'close', state: 'failed', error: REAL.openrouter401 },
      ] as any,
      running: false,
      read: true,
      who: 'product',
      noSubject: false,
      missing: [],
      first: [],
      stale: false,
      finish: 'Open scene',
    };
    const said = turnsFor(args(studio, { set })).find((t) => t.kind === 'scenri' && t.id === 'ex-failed-close');
    expect(said && said.kind === 'scenri' ? said.text : '').not.toMatch(RAW);
  });
});
