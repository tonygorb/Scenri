import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, SpendCapError, type Core } from '../src/index.js';

let home: string;
let core: Core;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-core-'));
  core = createCore(home);
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true });
});

const brandJson = { specVersion: '0.1', meta: { name: 'Acme Coffee' } };

describe('brands + projects', () => {
  it('creates brand with slug, round-trips json, updates and lists', () => {
    const b = core.store.createBrand(brandJson as any);
    expect(b.slug).toBe('acme-coffee');
    expect((b.json as any).meta.name).toBe('Acme Coffee');
    const updated = core.store.updateBrand(b.id, { ...brandJson, meta: { name: 'Acme Tea' } } as any)!;
    expect(updated.slug).toBe('acme-tea');
    expect(core.store.listBrands()).toHaveLength(1);
  });

  it('keeps slugs unique: the slug is the brand URL, so it cannot be shared or stolen', () => {
    const first = core.store.createBrand(brandJson as any);
    const second = core.store.createBrand(brandJson as any);
    expect(first.slug).toBe('acme-coffee');
    expect(second.slug).toBe('acme-coffee-2');

    // renaming onto a taken name suffixes rather than taking the other's URL
    const renamed = core.store.updateBrand(second.id, {
      ...brandJson,
      meta: { name: 'Acme Coffee' },
    } as any)!;
    expect(renamed.slug).toBe('acme-coffee-2');
    expect(core.store.getBrand(first.id)!.slug).toBe('acme-coffee');

    // and a brand keeps its own slug when saved with an unchanged name
    expect(core.store.updateBrand(first.id, brandJson as any)!.slug).toBe('acme-coffee');
  });

  it('keeps the letters of a name written in any script', () => {
    const named = (name: string) => core.store.createBrand({ specVersion: '0.1', meta: { name } } as any).slug;
    // the old filter kept only a-z, so each of these flattened to "brand"
    expect(named('מותג קפה')).toBe('מותג-קפה');
    expect(named('قهوة أكمي')).toBe('قهوة-أكمي');
    expect(named('Кофе Акме')).toBe('кофе-акме');
    // latin accents fold, because café and cafe are one word to anyone typing
    expect(named('Café Ölwerk')).toBe('cafe-olwerk');
    // mixed scripts keep both halves
    expect(named('Acme קפה')).toBe('acme-קפה');
    // and a name with no letters at all still has to be addressable
    expect(named('☕️ !!! ☕️')).toBe('brand');
  });

  it('creates project with done root node', () => {
    const b = core.store.createBrand(brandJson as any);
    const { project, root } = core.store.createProject(b.id, 'Summer campaign');
    expect(project.slug).toBe('summer-campaign');
    expect(root.kind).toBe('root');
    expect(root.status).toBe('done');
    expect(core.store.treeFor(project.id)).toHaveLength(1);
  });

  it('scopes project slugs to the brand: same name, different brands, no suffix', () => {
    const one = core.store.createBrand(brandJson as any);
    const two = core.store.createBrand({ specVersion: '0.1', meta: { name: 'Beta' } } as any);
    expect(core.store.createProject(one.id, 'Untitled').project.slug).toBe('untitled');
    expect(core.store.createProject(two.id, 'Untitled').project.slug).toBe('untitled');
    // but a second Untitled inside one brand has to be told apart
    expect(core.store.createProject(one.id, 'Untitled').project.slug).toBe('untitled-2');
    expect(core.store.listProjects(one.id).map((p) => p.slug)).toEqual(['untitled', 'untitled-2']);
  });
});

describe('version tree', () => {
  it('branches: two children off root, one grandchild; complete/fail/keep', () => {
    const b = core.store.createBrand(brandJson as any);
    const { project, root } = core.store.createProject(b.id, 'p');
    const a = core.store.addNode({
      projectId: project.id,
      parentId: root.id,
      kind: 'generation',
      prompt: 'hero shot',
      engineId: 'demo',
    });
    const c = core.store.addNode({
      projectId: project.id,
      parentId: root.id,
      kind: 'generation',
      prompt: 'alt shot',
      engineId: 'demo',
    });
    core.store.completeNode(a.id, { images: ['a'.repeat(32)], costUsd: 0.05 });
    core.store.failNode(c.id, 'boom');
    const g = core.store.addNode({
      projectId: project.id,
      parentId: a.id,
      kind: 'edit',
      prompt: 'warmer light',
      engineId: 'demo',
    });
    core.store.setKept(g.id, true);

    const tree = core.store.treeFor(project.id);
    expect(tree).toHaveLength(4);
    expect(core.store.getNode(a.id)!.status).toBe('done');
    expect(core.store.getNode(c.id)!.error).toBe('boom');
    expect(core.store.getNode(g.id)!.parentId).toBe(a.id);
    expect(core.store.getNode(g.id)!.kept).toBe(true);
  });

  it('rejects parent from another project', () => {
    const b = core.store.createBrand(brandJson as any);
    const p1 = core.store.createProject(b.id, 'p1');
    const p2 = core.store.createProject(b.id, 'p2');
    expect(() =>
      core.store.addNode({
        projectId: p2.project.id,
        parentId: p1.root.id,
        kind: 'generation',
        prompt: 'x',
        engineId: 'demo',
      }),
    ).toThrow(/parent node/);
  });
});

describe('restart sweep', () => {
  it('marks running nodes as error on reopen', () => {
    const b = core.store.createBrand(brandJson as any);
    const { project, root } = core.store.createProject(b.id, 'p');
    const n = core.store.addNode({
      projectId: project.id,
      parentId: root.id,
      kind: 'generation',
      prompt: 'x',
      engineId: 'demo',
    });
    expect(core.store.getNode(n.id)!.status).toBe('running');
    core.close();
    core = createCore(home); // reopen same dir
    const after = core.store.getNode(n.id)!;
    expect(after.status).toBe('error');
    expect(after.error).toMatch(/interrupted/);
  });
});

describe('image store', () => {
  it('dedupes identical buffers and validates hashes', () => {
    const buf = Buffer.from('fake-png-bytes');
    const h1 = core.images.save(buf);
    const h2 = core.images.save(buf);
    expect(h1).toBe(h2);
    expect(core.images.has(h1)).toBe(true);
    expect(core.images.read(h1).equals(buf)).toBe(true);
    expect(() => core.images.pathFor('../etc/passwd')).toThrow(/invalid/);
  });
});

describe('ledger + caps', () => {
  it('accumulates monthly spend per engine and enforces caps', () => {
    core.ledger.recordCost('openrouter', null, 0.4);
    core.ledger.recordCost('openrouter', null, 0.35);
    core.ledger.recordCost('fal', null, 0.02);
    expect(core.ledger.monthlySpend('openrouter')).toBeCloseTo(0.75);

    core.ledger.setCap('openrouter', 1.0);
    expect(() => core.ledger.assertUnderCap('openrouter', 0.2)).not.toThrow();
    expect(() => core.ledger.assertUnderCap('openrouter', 0.3)).toThrow(SpendCapError);

    core.ledger.setCap('openrouter', null);
    expect(() => core.ledger.assertUnderCap('openrouter', 99)).not.toThrow();
    expect(core.ledger.totalSpendByEngine()).toMatchObject({ fal: 0.02 });
  });

  it('zero-cost engines never blocked, never recorded', () => {
    core.ledger.setCap('codex-cli', 0);
    expect(() => core.ledger.assertUnderCap('codex-cli', 0)).not.toThrow();
    core.ledger.recordCost('codex-cli', null, 0);
    expect(core.ledger.monthlySpend('codex-cli')).toBe(0);
  });
});
