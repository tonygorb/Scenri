import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter, type GenerateRequest } from '@scenri/core';
import { buildServer } from '../src/server.js';
import { resetAssetBuilds } from '../src/customAssets.js';
import { resetPresenterDrafts, runningDraftJobCount } from '../src/presenterDrafts.js';

/**
 * The presenter draft routes when two things meet: a Save beside a draw or a
 * Discard, words that change while a view draws, an engine probe that goes slow
 * or fails, a Stop or a brand delete that reaches a draw in flight. The engine
 * is the spy the other draft route tests use, with a gate that holds its next
 * draw open.
 */

/**
 * The next draw waits here until released. With `hearsAbort` a Stop rejects it,
 * the way a killed codex child answers nothing; without it the draw answers
 * anyway, the way a remote provider finishes whatever it was told.
 */
type Hold = { release?: () => void; hash?: string; hearsAbort?: boolean };

describe('presenter drafts when two things meet', () => {
  let home: string;
  let templatesDir: string;
  let core: Core;
  let app: ReturnType<typeof buildServer>;
  let generated: GenerateRequest[];
  let signals: AbortSignal[];
  /** What the engine probe answers. */
  let available: boolean;
  /** When set, the engine probe waits here: a probe past its cache, slow to answer. */
  let probeGate: Promise<void> | null;
  let holdNext: Hold | null;

  const png = (n: number) =>
    sharp({
      create: { width: 512, height: 640, channels: 3, background: { r: (0x20 + n * 0x0b) % 256, g: 0x40, b: 0x50 } },
    })
      .png()
      .toBuffer();

  const engine = (): EngineAdapter => ({
    capabilities: () => ({
      id: 'spy',
      displayName: 'Spy',
      localOnly: false,
      supportsEdit: true,
      supportsMask: false,
      maxReferenceImages: 5,
    }),
    isAvailable: async () => {
      if (probeGate) await probeGate;
      return available ? { ok: true } : { ok: false, reason: 'codex probe timed out' };
    },
    costEstimate: async () => 0,
    generate: async (req, signal) => {
      generated.push(req);
      if (signal) signals.push(signal);
      const n = generated.length;
      const hold = holdNext;
      if (hold) {
        holdNext = null;
        await new Promise<void>((resolve, reject) => {
          hold.release = resolve;
          if (hold.hearsAbort) signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      const hash = core.images.save(await png(n));
      if (hold) hold.hash = hash;
      return { images: [hash], costUsd: 0 };
    },
    edit: async () => ({ images: [], costUsd: 0 }),
  });

  beforeEach(() => {
    resetAssetBuilds();
    resetPresenterDrafts();
    generated = [];
    signals = [];
    available = true;
    probeGate = null;
    holdNext = null;
    templatesDir = mkdtempSync(join(tmpdir(), 'sc-pdraces-tpl-'));
    mkdirSync(join(templatesDir, 'presenters'), { recursive: true });
    home = mkdtempSync(join(tmpdir(), 'sc-pdraces-home-'));
    core = createCore(home);
    const e = engine();
    app = buildServer({
      core,
      engines: { all: () => [e], get: (id) => (id === 'spy' ? e : null) },
      templatesDir,
      analyzer: { isAvailable: async () => ({ ok: false, reason: 'off' }), analyze: async () => ({}) as any },
    });
  });

  afterEach(async () => {
    holdNext?.release?.();
    resetPresenterDrafts();
    resetAssetBuilds();
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(templatesDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const j = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) } as any);
    return { status: res.statusCode, body: res.json() as any };
  };

  const settled = async (base: string, id: string) => {
    for (let i = 0; i < 400; i++) {
      const { body } = await j('GET', `${base}/${id}`);
      if (body.stage === 'idle' && !body.activeView && runningDraftJobCount() === 0) return body;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('the draft never settled');
  };

  /** Until the held draw has reached the engine. */
  const reached = async (hold: Hold) => {
    for (let i = 0; i < 200 && !hold.release; i++) await new Promise((r) => setTimeout(r, 5));
  };

  /** A brand and a synthetic draft in it, with the given views drawn and approved by hand. */
  const draft = async (views: string[], over: Record<string, unknown> = {}) => {
    const brand = (await j('POST', '/api/brands', { brand: { specVersion: '0.1', meta: { name: 'Acme' } } })).body;
    const base = `/api/brands/${brand.id}/presenter-drafts`;
    const id = (
      await j('POST', base, { source: 'synthetic', direction: 'a woman in her forties', name: 'Mara', ...over })
    ).body.id as string;
    for (const v of views) {
      expect((await j('POST', `${base}/${id}/views/${v}/generate`, {})).status).toBe(200);
      await settled(base, id);
      expect((await j('POST', `${base}/${id}/views/${v}/approve`)).status).toBe(200);
      await settled(base, id);
    }
    return { brandId: brand.id as string, base, id };
  };

  const characters = (brandId: string) => ((core.store.getBrand(brandId)!.json as any).characters ?? []) as any[];

  describe('the set chain', () => {
    it('stops quietly when the direction is cleared mid-set, never with an unhandled rejection (PS-H1)', async () => {
      const escaped: unknown[] = [];
      const onRejection = (reason: unknown) => escaped.push(reason);
      process.on('unhandledRejection', onRejection);
      try {
        const { base, id } = await draft(['portrait', 'front'], { direction: 'a man in his thirties', extras: true });
        const hold: Hold = {};
        holdNext = hold;
        expect((await j('POST', `${base}/${id}/views/three-quarter/generate`, { decide: 'auto' })).status).toBe(200);
        await reached(hold);
        // accepted while the view draws: nothing on PATCH looks at the running draw
        expect((await j('PATCH', `${base}/${id}`, { direction: '' })).status).toBe(200);
        hold.release?.();

        const after = await settled(base, id);
        // let the process emit anything that escaped the chain
        await new Promise((r) => setTimeout(r, 50));
        expect(after.views['three-quarter'].status).toBe('approved');
        expect(escaped.map((e: any) => e?.message ?? String(e))).toEqual([]);
      } finally {
        process.off('unhandledRejection', onRejection);
      }
    });

    it('does not let a view drawn before the words changed stand approved on the old words (PS-H4)', async () => {
      const { base, id } = await draft(['portrait', 'front']);
      const hold: Hold = {};
      holdNext = hold;
      expect((await j('POST', `${base}/${id}/views/three-quarter/generate`, { decide: 'auto' })).status).toBe(200);
      await reached(hold);
      const drawnFrom = generated[generated.length - 1].prompt;
      const patched = await j('PATCH', `${base}/${id}`, {
        keepItems: [{ id: 'glasses', words: 'round tortoiseshell glasses' }],
      });
      expect(patched.status).toBe(200);
      hold.release?.();
      const after = await settled(base, id);
      expect(drawnFrom).not.toMatch(/glasses/);
      // it lands stale and the set draws it again from the words that stand now
      if (after.views['three-quarter'].status === 'approved') {
        expect(generated.length).toBeGreaterThan(3);
        expect(generated[generated.length - 1].prompt).toMatch(/glasses/);
      }
    });
  });

  describe('a Save', () => {
    it('keeps every approved view when the engine probe fails at that moment (PS-H2)', async () => {
      const { brandId, base, id } = await draft(['portrait', 'front', 'three-quarter']);
      const approved = (await j('GET', `${base}/${id}`)).body;
      const want = ['portrait', 'front', 'three-quarter'].map((v) => approved.views[v].hash);
      // the probe is asked per request; a slow or signed-out codex answers "not available"
      available = false;
      const saved = await j('POST', `${base}/${id}/save`);
      const people = characters(brandId);
      // either the save refuses and the draft stays, or it saves the whole approved set
      if (saved.status === 200) {
        expect(people).toHaveLength(1);
        const shots = (people[0].referenceShots ?? people[0].shots ?? []).map((s: any) =>
          String(s.file ?? s).replace(/^asset:/, ''),
        );
        expect(shots).toEqual(expect.arrayContaining(want));
      } else {
        expect((await j('GET', `${base}/${id}`)).status).toBe(200);
      }
    });

    it('pressed twice at once makes one presenter (PS-H3)', async () => {
      const { brandId, base, id } = await draft(['portrait', 'front', 'three-quarter']);
      const [a, b] = await Promise.all([j('POST', `${base}/${id}/save`), j('POST', `${base}/${id}/save`)]);
      expect(characters(brandId).filter((c) => c.name === 'Mara')).toHaveLength(1);
      expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    });

    it('refuses a draw asked for while it writes, and spends nothing on a draft about to go (PS-H3)', async () => {
      const { base, id } = await draft(['portrait', 'front', 'three-quarter']);
      const before = generated.length;
      const [saved, drawn] = await Promise.all([
        j('POST', `${base}/${id}/save`),
        j('POST', `${base}/${id}/views/three-quarter/generate`, { adjustment: 'arms crossed' }),
      ]);
      for (let i = 0; i < 200 && runningDraftJobCount() > 0; i++) await new Promise((r) => setTimeout(r, 5));
      expect(saved.status).toBe(200);
      expect({ refused: [404, 409].includes(drawn.status), spent: generated.length - before }).toEqual({
        refused: true,
        spent: 0,
      });
    });

    it('never leaves the saved presenter without its pictures when a Discard lands meanwhile (PS1-X1)', async () => {
      const { brandId, base, id } = await draft(['portrait', 'front', 'three-quarter']);
      const [saved, discarded] = await Promise.all([j('POST', `${base}/${id}/save`), j('DELETE', `${base}/${id}`)]);
      expect(discarded.status).toBe(200);
      const people = characters(brandId);
      if (saved.status === 200) {
        expect(people).toHaveLength(1);
        const missing = people[0].shots
          .map((s: any) => String(s.file).replace(/^asset:/, ''))
          .filter((h: string) => !core.images.has(h));
        expect(missing).toEqual([]);
      } else expect(people).toHaveLength(0);
    });
  });

  describe('Stop, Delete and a brand delete', () => {
    /** A draft whose face is drawing, with the engine probe then gone slow. */
    const drawingWithSlowProbe = async () => {
      const { base, id } = await draft([], { direction: 'a warm man in his thirties' });
      const hold: Hold = { hearsAbort: true };
      holdNext = hold;
      expect((await j('POST', `${base}/${id}/views/portrait/generate`, {})).status).toBe(200);
      await reached(hold);
      let open!: () => void;
      probeGate = new Promise<void>((r) => {
        open = r;
      });
      return { base, id, open };
    };
    const within = (ms: number) => new Promise<'waiting'>((r) => setTimeout(() => r('waiting'), ms));

    it('Stop answers without waiting on an engine probe it does not need (PS-H15)', async () => {
      const { base, id, open } = await drawingWithSlowProbe();
      const stop = app.inject({ method: 'POST', url: `${base}/${id}/stop` });
      const outcome = await Promise.race([stop.then(() => 'answered' as const), within(1000)]);
      open();
      const res = await stop;
      expect(outcome).toBe('answered');
      expect(res.json().views.portrait.status).not.toBe('generating');
    });

    it('Delete answers without waiting on an engine probe it does not need (PS-H15)', async () => {
      const { base, id, open } = await drawingWithSlowProbe();
      const del = app.inject({ method: 'DELETE', url: `${base}/${id}` });
      const outcome = await Promise.race([del.then(() => 'answered' as const), within(1000)]);
      open();
      await del;
      expect(outcome).toBe('answered');
    });

    it('leaves no picture on disk that the engine hands back after Stop (PS-H8)', async () => {
      const { base, id } = await draft([], { direction: 'a man in his thirties' });
      const hold: Hold = {};
      holdNext = hold;
      expect((await j('POST', `${base}/${id}/views/portrait/generate`, {})).status).toBe(200);
      await reached(hold);
      const stopping = j('POST', `${base}/${id}/stop`);
      await new Promise((r) => setTimeout(r, 20));
      hold.release?.();
      const stopped = await stopping;
      expect(stopped.body.views.portrait.error).toBe('cancelled');
      expect(stopped.body.views.portrait.hash).toBeUndefined();
      expect(hold.hash).toBeTruthy();
      // nothing holds it: not the draft, not a record
      expect(core.images.has(hold.hash as string)).toBe(false);
    });

    it('a brand delete stops its presenter draw, and the draw is busy until the engine lets go (PS-H8)', async () => {
      const { brandId, base, id } = await draft([], { direction: 'a man in his thirties' });
      const hold: Hold = {};
      holdNext = hold;
      expect((await j('POST', `${base}/${id}/views/portrait/generate`, {})).status).toBe(200);
      await reached(hold);
      expect((await j('DELETE', `/api/brands/${brandId}`)).status).toBe(200);
      expect((await j('GET', `${base}/${id}`)).status).toBe(404);
      expect(signals.at(-1)?.aborted).toBe(true);
      hold.release?.();
      for (let i = 0; i < 200 && runningDraftJobCount() > 0; i++) await new Promise((r) => setTimeout(r, 5));
      expect(runningDraftJobCount()).toBe(0);
    });
  });
});
