import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core } from '@scenri/core';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { applyIntent, readGuide, stampGuide } from '../src/routes/guide.js';

const brand = (name: string, extra: Record<string, unknown> = {}) => ({ specVersion: '0.1', meta: { name }, ...extra });
const V = '1.2.0';
/** Past the database clock's millisecond, so "before" and "after" a task are never the same instant. */
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('first-use record', () => {
  let home: string;
  let core: Core;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sc-guide-'));
    core = createCore(home);
  });

  afterEach(() => {
    core.close();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  describe('who is new', () => {
    it('a home with no brands at its first boot is new, and has read its own version', () => {
      stampGuide(core.store, V);
      const g = readGuide(core, {});
      expect(g).toMatchObject({ eligible: true, welcome: null, hidden: false, done: {}, dismissed: [], active: null });
      expect(core.store.getSetting('whatsnew.seen')).toBe(V);
      expect(core.store.getSetting('install.firstVersion')).toBe(V);
    });

    it('a home that already has a brand at that boot is not, and keeps its unread notes', () => {
      core.store.createBrand(brand('Existing'));
      core.store.setSetting('whatsnew.seen', '1.0.0');
      stampGuide(core.store, V);
      expect(readGuide(core, {}).eligible).toBe(false);
      expect(core.store.getSetting('whatsnew.seen')).toBe('1.0.0');
    });

    it('stamps once: brands created or deleted later never change it', () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('First'));
      stampGuide(core.store, V);
      core.store.deleteBrand(b.id);
      stampGuide(core.store, V);
      expect(readGuide(core, {}).eligible).toBe(true);
    });

    it('never lowers a newer acknowledgement, and a later boot leaves the notes alone', () => {
      core.store.setSetting('whatsnew.seen', '2.0.0');
      stampGuide(core.store, V);
      expect(core.store.getSetting('whatsnew.seen')).toBe('2.0.0');
      core.store.setSetting('whatsnew.seen', '1.0.0');
      stampGuide(core.store, '1.3.0');
      expect(core.store.getSetting('whatsnew.seen')).toBe('1.0.0');
    });

    it('SCENRI_NO_GUIDE silences the boot decision without touching the record', () => {
      stampGuide(core.store, V);
      expect(readGuide(core, { SCENRI_NO_GUIDE: '1' })).toMatchObject({ eligible: false, hidden: true });
      expect(readGuide(core, {})).toMatchObject({ eligible: true, hidden: false });
    });

    it('First steps shows to someone new; anyone else sees it only after asking, and a hide is kept', () => {
      core.store.createBrand(brand('Old hand'));
      stampGuide(core.store, V);
      expect(readGuide(core, {}).hidden).toBe(true);
      applyIntent(core, { hidden: false });
      expect(readGuide(core, {}).hidden).toBe(false);
      applyIntent(core, { hidden: true });
      expect(readGuide(core, {}).hidden).toBe(true);
    });

    it('a record from before this one is nobody new: the guidance is never replayed at an old install', () => {
      core.store.setSetting('guide', JSON.stringify({ v: 1, eligible: true, learned: ['welcome'] }));
      expect(readGuide(core, {})).toMatchObject({ eligible: false, welcome: null, active: null });
    });

    it('an install stamped new while first use was off, who has since made a shot, is not new', () => {
      // The record 0.11.1 and 0.12.0 wrote at a fresh install, then a library used for real.
      stampGuide(core.store, '0.12.0');
      const b = core.store.createBrand(brand('Used'));
      const { project, root } = core.store.createProject(b.id, 'Work');
      const n = core.store.addNode({
        projectId: project.id,
        parentId: root.id,
        kind: 'generation',
        prompt: 'p',
        engineId: 'demo',
      });
      core.store.completeNode(n.id, { images: ['abc'], costUsd: 0 });
      expect(readGuide(core, {})).toMatchObject({ eligible: false, welcome: null, hidden: true });
    });

    it('that install with a brand but no shot yet is still offered the welcome', () => {
      stampGuide(core.store, '0.12.0');
      core.store.createBrand(brand('Started'));
      expect(readGuide(core, {})).toMatchObject({ eligible: true, welcome: null, hidden: false });
    });

    it('someone new who took the welcome stays new after their first shot', () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Taught'));
      applyIntent(core, { welcome: 'taken' });
      const { project, root } = core.store.createProject(b.id, 'Work');
      const n = core.store.addNode({
        projectId: project.id,
        parentId: root.id,
        kind: 'generation',
        prompt: 'p',
        engineId: 'demo',
      });
      core.store.completeNode(n.id, { images: ['abc'], costUsd: 0 });
      expect(readGuide(core, {})).toMatchObject({ eligible: true, welcome: 'taken' });
    });

    it('an unreadable record is nobody new, and never throws', () => {
      core.store.setSetting('guide', '{not json');
      expect(readGuide(core, {})).toMatchObject({ eligible: false, done: {}, active: null });
    });
  });

  describe('what the library proves', () => {
    const shot = (brandId: string, kind: 'generation' | 'edit', images: string[] | null) => {
      const { project, root } = core.store.createProject(brandId, 'Work');
      const n = core.store.addNode({ projectId: project.id, parentId: root.id, kind, prompt: 'p', engineId: 'demo' });
      if (images) core.store.completeNode(n.id, { images, costUsd: 0 });
      return n;
    };

    it('a finished shot and a finished refinement, with a picture, each count; a running one does not', () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Shots'));
      shot(b.id, 'generation', null);
      expect(readGuide(core, {}).done.shot).toBeUndefined();
      shot(b.id, 'generation', ['abc']);
      shot(b.id, 'edit', ['def']);
      const g = readGuide(core, {});
      expect(g.done.shot).toBeTypeOf('string');
      expect(g.done.refine).toBeTypeOf('string');
    });

    it('a finished shot with no picture is not a shot', () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Empty'));
      shot(b.id, 'generation', []);
      expect(readGuide(core, {}).done.shot).toBeUndefined();
    });

    it('a presenter, a scene and a product in any brand each count; a replaced presenter record does not', () => {
      stampGuide(core.store, V);
      core.store.createBrand(brand('Replaced', { characters: [{ id: 'a', origin: 'custom', supersededBy: 'b' }] }));
      expect(readGuide(core, {}).done.presenter).toBeUndefined();
      core.store.createBrand(
        brand('Full', {
          characters: [{ id: 'c', origin: 'custom' }],
          scenes: [{ id: 's' }],
          products: [{ id: 'p', shots: [] }],
        }),
      );
      expect(Object.keys(readGuide(core, {}).done).sort()).toEqual(['presenter', 'product', 'scene']);
    });

    it('a lesson is taught by finishing it, never by what the library happens to hold', () => {
      stampGuide(core.store, V);
      // a library full of work proves the milestones, and teaches nothing
      const b = core.store.createBrand(
        brand('Busy', { characters: [{ id: 'c', origin: 'custom' }], scenes: [{ id: 's' }], products: [{ id: 'p' }] }),
      );
      const full = readGuide(core, {});
      expect(Object.keys(full.done).sort()).toEqual(['presenter', 'product', 'scene']);
      expect(full.lessons).toEqual({});

      // walking one to its end teaches that one, and says nothing about the rest
      applyIntent(core, { start: { task: 'scene', brandId: b.id } });
      applyIntent(core, { finish: 'scene' });
      const after = readGuide(core, {});
      expect(after.lessons.scene).toBeTypeOf('string');
      expect(Object.keys(after.lessons)).toEqual(['scene']);
      // and it stays taught after what it made is gone
      const at = after.lessons.scene;
      core.store.deleteBrand(b.id);
      expect(readGuide(core, {}).lessons.scene).toBe(at);
    });

    it('once seen, a step stays done after the thing is deleted', () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Brief', { scenes: [{ id: 's' }] }));
      const at = readGuide(core, {}).done.scene;
      core.store.deleteBrand(b.id);
      expect(readGuide(core, {}).done.scene).toBe(at);
    });
  });

  describe('tasks', () => {
    it('starting a task stamps its moment and the brand as it was; what came after is what it made', async () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Task'));
      const { project, root } = core.store.createProject(b.id, 'Work');
      core.store.addNode({
        projectId: project.id,
        parentId: root.id,
        kind: 'generation',
        prompt: 'before',
        engineId: 'demo',
      });
      await tick();
      expect(applyIntent(core, { start: { task: 'first-shot', brandId: b.id } })).toBeNull();
      await tick();
      const made = core.store.addNode({
        projectId: project.id,
        parentId: root.id,
        kind: 'generation',
        prompt: 'after',
        engineId: 'demo',
      });
      const g = readGuide(core, {});
      expect(g.active).toMatchObject({
        task: 'first-shot',
        brandId: b.id,
        baseline: { products: 0, presenters: 0, scenes: 0 },
      });
      expect(g.activeNodes.map((n) => n.id)).toEqual([made.id]);
      expect(g.activeNodes[0]).toMatchObject({ status: 'running', images: 0 });
      core.store.completeNode(made.id, { images: ['x', 'y'], costUsd: 0 });
      expect(readGuide(core, {}).activeNodes[0]).toMatchObject({ status: 'done', images: 2 });
    });

    it('a presenter task finds the draft it started, never an older one or an edit session', async () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Drafts'));
      core.store.putPresenterDraft({ id: 'pd-old', brandId: b.id, json: {} });
      await tick();
      applyIntent(core, { start: { task: 'presenter', brandId: b.id } });
      await tick();
      core.store.putPresenterDraft({ id: 'pd-edit', brandId: b.id, json: { presenterId: 'up-1' } });
      expect(readGuide(core, {}).activeDraftId).toBeNull();
      core.store.putPresenterDraft({ id: 'pd-new', brandId: b.id, json: {} });
      expect(readGuide(core, {}).activeDraftId).toBe('pd-new');
    });

    it('the counts move against the baseline, so a task that makes one knows when it has', () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Counts', { scenes: [{ id: 'old' }] }));
      applyIntent(core, { start: { task: 'scene', brandId: b.id } });
      expect(readGuide(core, {}).active?.baseline.scenes).toBe(1);
      core.store.updateBrand(b.id, brand('Counts', { scenes: [{ id: 'old' }, { id: 'new' }] }));
      expect(readGuide(core, {}).counts?.scenes).toBe(2);
    });

    it('finish ends the task; dismiss pauses it, is remembered, and a start continues it as it was', () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Ends'));
      applyIntent(core, { start: { task: 'refine', brandId: b.id } });
      applyIntent(core, { finish: 'first-shot' });
      expect(readGuide(core, {}).active?.task).toBe('refine');
      const since = readGuide(core, {}).active?.since;
      applyIntent(core, { dismiss: 'refine' });
      // the guide is closed, so nothing is guiding; the lesson is still part done
      const shut = readGuide(core, {});
      expect(shut.active).toBeNull();
      expect(shut).toMatchObject({ dismissed: ['refine'] });
      expect(shut.progress.refine).toMatchObject({ since, paused: true });
      // continued: the same window it began with, so what it made still counts
      applyIntent(core, { start: { task: 'refine', brandId: b.id } });
      const going = readGuide(core, {});
      expect(going).toMatchObject({ active: { task: 'refine', since }, dismissed: [] });
      expect(going.active?.paused).toBeUndefined();
      applyIntent(core, { finish: 'refine' });
      const ended = readGuide(core, {});
      expect(ended.active).toBeNull();
      expect(ended.progress.refine).toBeUndefined();
    });

    it('several lessons can be part done at once, and starting one costs the others nothing', () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Many Lessons'));
      // one lesson under way, five milestones into it
      applyIntent(core, { start: { task: 'first-shot', brandId: b.id } });
      for (const m of ['go', 'product', 'presenter', 'scene', 'make'])
        applyIntent(core, { reached: { task: 'first-shot', moment: m } });
      const first = readGuide(core, {}).progress['first-shot'];
      expect(first?.reached).toEqual(['go', 'product', 'presenter', 'scene', 'make']);

      // another lesson takes the screen: the first keeps everything but the screen
      applyIntent(core, { start: { task: 'product', brandId: b.id } });
      const two = readGuide(core, {});
      expect(two.active?.task).toBe('product');
      expect(two.progress['first-shot']).toMatchObject({ since: first?.since, paused: true });
      expect(two.progress['first-shot']?.reached).toEqual(first?.reached);
      expect(two.progress.product).toMatchObject({ brandId: b.id, reached: [] });

      // and a third, with the first two still standing
      applyIntent(core, { reached: { task: 'product', moment: 'product' } });
      applyIntent(core, { start: { task: 'scene', brandId: b.id } });
      const three = readGuide(core, {});
      expect(Object.keys(three.progress).sort()).toEqual(['first-shot', 'product', 'scene']);
      expect(three.progress.product?.reached).toEqual(['product']);

      // back to the first: the same window, the same milestones, guiding again
      applyIntent(core, { start: { task: 'first-shot', brandId: b.id } });
      const back = readGuide(core, {});
      expect(back.active).toMatchObject({ task: 'first-shot', since: first?.since });
      expect(back.active?.paused).toBeUndefined();
      expect(back.progress['first-shot']?.reached).toEqual(first?.reached);
      expect(back.progress.product?.paused).toBe(true);

      // finished, it is no longer part done, and taking it again starts over
      applyIntent(core, { finish: 'first-shot' });
      const after = readGuide(core, {});
      expect(after.lessons['first-shot']).toBeTypeOf('string');
      expect(after.progress['first-shot']).toBeUndefined();
      expect(after.progress.product?.reached).toEqual(['product']);
    });

    it('a milestone is noted once, by name, and only for a lesson under way', () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Named'));
      // nothing under way: there is nothing to note it against
      applyIntent(core, { reached: { task: 'scene', moment: 'scene' } });
      expect(readGuide(core, {}).progress.scene).toBeUndefined();
      applyIntent(core, { start: { task: 'scene', brandId: b.id } });
      applyIntent(core, { reached: { task: 'scene', moment: 'scene' } });
      applyIntent(core, { reached: { task: 'scene', moment: 'scene' } });
      expect(readGuide(core, {}).progress.scene?.reached).toEqual(['scene']);
      expect(applyIntent(core, { reached: { task: 'scene', moment: '' } })).toBe('moment required');
    });

    it('closing the guide sets the lesson down without losing it', () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Closed'));
      applyIntent(core, { start: { task: 'presenter', brandId: b.id } });
      applyIntent(core, { reached: { task: 'presenter', moment: 'start' } });
      applyIntent(core, { dismiss: 'presenter' });
      const shut = readGuide(core, {});
      // nothing is guiding, and the lesson is still part done
      expect(shut.active).toBeNull();
      expect(shut.progress.presenter).toMatchObject({ paused: true, reached: ['start'] });
    });

    it('taking up another lesson sets the first down, and coming back continues it', async () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Two Lessons'));
      applyIntent(core, { start: { task: 'presenter', brandId: b.id } });
      const first = readGuide(core, {}).active?.since;

      // another lesson takes the screen; the first is set down, not dropped
      applyIntent(core, { start: { task: 'scene', brandId: b.id } });
      expect(readGuide(core, {}).active).toMatchObject({ task: 'scene' });

      // back to it: the same window, so its draft and its shots still count
      applyIntent(core, { start: { task: 'presenter', brandId: b.id } });
      const back = readGuide(core, {});
      expect(back.active).toMatchObject({ task: 'presenter', since: first });
      expect(back.active?.paused).toBeUndefined();

      // finished, it is waiting nowhere: beginning it again is a fresh window
      // (a millisecond later, or the database clock gives the same stamp)
      await tick();
      applyIntent(core, { finish: 'presenter' });
      applyIntent(core, { start: { task: 'scene', brandId: b.id } });
      applyIntent(core, { start: { task: 'presenter', brandId: b.id } });
      expect(readGuide(core, {}).active?.since).not.toBe(first);
    });

    it('a paused task gives way to another task begun, and a paused record survives a restart', () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Paused'));
      applyIntent(core, { start: { task: 'presenter', brandId: b.id } });
      applyIntent(core, { dismiss: 'presenter' });
      expect(readGuide(core, {}).active).toBeNull();
      // the record is read fresh each time: a lesson set down is still set down after a restart
      expect(readGuide(core, {}).progress.presenter).toMatchObject({ paused: true });
      applyIntent(core, { start: { task: 'scene', brandId: b.id } });
      expect(readGuide(core, {}).active).toMatchObject({ task: 'scene' });
      expect(readGuide(core, {}).active?.paused).toBeUndefined();
      // and the one set down is still there, waiting
      expect(readGuide(core, {}).progress.presenter).toMatchObject({ paused: true });
    });

    it('a task whose brand is deleted is let go', () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Gone'));
      applyIntent(core, { start: { task: 'first-shot', brandId: b.id } });
      core.store.deleteBrand(b.id);
      expect(readGuide(core, {}).active).toBeNull();
    });

    it('a task someone starts runs even where tests silence the boot decision', () => {
      stampGuide(core.store, V);
      const b = core.store.createBrand(brand('Silenced'));
      applyIntent(core, { start: { task: 'product', brandId: b.id } });
      expect(readGuide(core, { SCENRI_NO_GUIDE: '1' })).toMatchObject({ eligible: false, active: { task: 'product' } });
    });

    it('refuses what makes no sense', () => {
      stampGuide(core.store, V);
      expect(applyIntent(core, { start: { task: 'tour', brandId: 'x' } })).toBe('unknown task');
      expect(applyIntent(core, { start: { task: 'scene', brandId: 'missing' } })).toBe('brand not found');
      expect(applyIntent(core, { welcome: 'maybe' })).toBe('welcome is taken or declined');
      expect(applyIntent(core, { hidden: 'yes' })).toBe('hidden is true or false');
      expect(applyIntent(core, { learned: 'refine' })).toBe('unknown intent');
      applyIntent(core, { welcome: 'taken' });
      applyIntent(core, { hidden: true });
      expect(readGuide(core, {})).toMatchObject({ welcome: 'taken', hidden: true });
    });
  });
});

describe('guide routes', () => {
  let home: string;
  let core: Core;
  let app: FastifyInstance;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sc-guide-api-'));
    core = createCore(home);
    app = buildServer({ core, engines: { all: () => [], get: () => null } });
  });

  afterEach(async () => {
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('boot stamps a fresh home; an intent answers with the new state; nonsense is a 400', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/guide' });
    expect(first.json()).toMatchObject({ eligible: true, welcome: null, active: null, activeNodes: [] });
    const post = await app.inject({ method: 'POST', url: '/api/guide', payload: { welcome: 'declined' } });
    expect(post.statusCode).toBe(200);
    expect(post.json().welcome).toBe('declined');
    const bad = await app.inject({ method: 'POST', url: '/api/guide', payload: { concept: 'tour' } });
    expect(bad.statusCode).toBe(400);
  });
});
