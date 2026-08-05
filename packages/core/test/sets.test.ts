import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core } from '../src/index.js';

let home: string;
let core: Core;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-sets-'));
  core = createCore(home);
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true });
});

const brandJson = { specVersion: '0.1', meta: { name: 'Acme Coffee' } };

/** A finished shot in a project, so the row survives the collapse. */
function shoot(projectId: string, prompt: string): string {
  const n = core.store.addNode({ projectId, parentId: null, kind: 'generation', prompt, engineId: 'demo' });
  core.store.completeNode(n.id, { images: [`hash-${prompt}`], costUsd: 0 });
  return n.id;
}

/** Close and reopen the same library: the migration only runs on open. */
function reopen(): void {
  core.close();
  core = createCore(home);
}

describe('projects collapse into one workspace, and become sets', () => {
  it('turns every project that held work into a set and drops the empty ones', () => {
    const brand = core.store.createBrand(brandJson as any);
    const campaign = core.store.createProject(brand.id, 'Campaign SS26').project;
    const packshots = core.store.createProject(brand.id, 'Packshots').project;
    core.store.createProject(brand.id, 'Untitled'); // never used: the litter
    shoot(campaign.id, 'a');
    shoot(campaign.id, 'b');
    shoot(packshots.id, 'c');

    reopen();

    // one hidden workspace, not four projects
    expect(core.store.listProjects(brand.id)).toHaveLength(1);
    const workspace = core.store.workspaceFor(brand.id);

    // the two that held work are sets now; the empty one left no trace
    const sets = core.store.listSets(brand.id);
    expect(sets.map((s) => s.name).sort()).toEqual(['Campaign SS26', 'Packshots']);
    expect(sets.map((s) => s.slug).sort()).toEqual(['campaign-ss26', 'packshots']);

    // every shot survived, under the one project, with one root above them
    const nodes = core.store.treeFor(workspace.id);
    expect(nodes.filter((n) => n.kind !== 'root')).toHaveLength(3);
    expect(nodes.filter((n) => n.kind === 'root')).toHaveLength(1);

    // and each landed in the set its project became
    const membership = core.store.membershipFor(brand.id);
    const byName = Object.fromEntries(sets.map((s) => [s.name, membership[s.id] ?? []]));
    expect(byName['Campaign SS26']).toHaveLength(2);
    expect(byName.Packshots).toHaveLength(1);
  });

  it('runs again without minting a second copy of everything', () => {
    const brand = core.store.createBrand(brandJson as any);
    const a = core.store.createProject(brand.id, 'One').project;
    const b = core.store.createProject(brand.id, 'Two').project;
    shoot(a.id, 'a');
    shoot(b.id, 'b');

    reopen();
    reopen();

    expect(core.store.listProjects(brand.id)).toHaveLength(1);
    expect(core.store.listSets(brand.id)).toHaveLength(2);
    expect(core.store.treeFor(core.store.workspaceFor(brand.id).id).filter((n) => n.kind !== 'root')).toHaveLength(2);
  });

  it('leaves a brand that never had a second project alone', () => {
    const brand = core.store.createBrand(brandJson as any);
    const only = core.store.createProject(brand.id, 'Only').project;
    shoot(only.id, 'a');

    reopen();

    // nothing to collapse means nothing invented: no set is born from a brand
    // that was already in the shape the new model wants
    expect(core.store.listProjects(brand.id)).toHaveLength(1);
    expect(core.store.listSets(brand.id)).toHaveLength(0);
  });

  it('keeps each brand to its own workspace', () => {
    const acme = core.store.createBrand(brandJson as any);
    const other = core.store.createBrand({ ...brandJson, meta: { name: 'Bruno Tea' } } as any);
    shoot(core.store.createProject(acme.id, 'A1').project.id, 'a');
    shoot(core.store.createProject(acme.id, 'A2').project.id, 'b');
    shoot(core.store.createProject(other.id, 'B1').project.id, 'c');
    shoot(core.store.createProject(other.id, 'B2').project.id, 'd');

    reopen();

    expect(core.store.listProjects(acme.id)).toHaveLength(1);
    expect(core.store.listProjects(other.id)).toHaveLength(1);
    expect(core.store.workspaceFor(acme.id).id).not.toBe(core.store.workspaceFor(other.id).id);
    expect(
      core.store
        .listSets(acme.id)
        .map((s) => s.name)
        .sort(),
    ).toEqual(['A1', 'A2']);
    expect(
      core.store
        .listSets(other.id)
        .map((s) => s.name)
        .sort(),
    ).toEqual(['B1', 'B2']);
  });
});

describe('sets', () => {
  it('makes the workspace on demand and only once', () => {
    const brand = core.store.createBrand(brandJson as any);
    const first = core.store.workspaceFor(brand.id);
    const second = core.store.workspaceFor(brand.id);
    expect(second.id).toBe(first.id);
    expect(core.store.listProjects(brand.id)).toHaveLength(1);
  });

  it('keeps slugs unique within the brand, on create and on rename', () => {
    const brand = core.store.createBrand(brandJson as any);
    const first = core.store.createSet(brand.id, 'Spring');
    const second = core.store.createSet(brand.id, 'Spring');
    expect(first.slug).toBe('spring');
    expect(second.slug).toBe('spring-2');

    // renaming onto a taken name suffixes rather than stealing the other's URL
    const third = core.store.createSet(brand.id, 'Autumn');
    expect(core.store.renameSet(third.id, 'Spring')!.slug).toBe('spring-3');
  });

  it('adds and removes membership without touching the shot', () => {
    const brand = core.store.createBrand(brandJson as any);
    const workspace = core.store.workspaceFor(brand.id);
    const shot = shoot(workspace.id, 'a');
    const campaign = core.store.createSet(brand.id, 'Campaign');
    const press = core.store.createSet(brand.id, 'Press');

    // the same shot in two sets at once: membership is a label, not ownership
    core.store.addToSet(campaign.id, [shot]);
    core.store.addToSet(press.id, [shot]);
    expect(core.store.membershipFor(brand.id)[campaign.id]).toEqual([shot]);
    expect(core.store.membershipFor(brand.id)[press.id]).toEqual([shot]);

    core.store.removeFromSet(campaign.id, shot);
    expect(core.store.membershipFor(brand.id)[campaign.id]).toBeUndefined();
    expect(core.store.getNode(shot)).not.toBeNull();

    // and deleting the set leaves the shot standing
    core.store.deleteSet(press.id);
    expect(core.store.getNode(shot)).not.toBeNull();
    expect(core.store.listSets(brand.id).map((s) => s.name)).toEqual(['Campaign']);
  });

  it('adding the same shot twice is not an error and not a duplicate', () => {
    const brand = core.store.createBrand(brandJson as any);
    const shot = shoot(core.store.workspaceFor(brand.id).id, 'a');
    const set = core.store.createSet(brand.id, 'Campaign');
    core.store.addToSet(set.id, [shot]);
    core.store.addToSet(set.id, [shot, shot]);
    expect(core.store.membershipFor(brand.id)[set.id]).toEqual([shot]);
  });

  it('reports the sets a shot is in on the activity feed, and none is a valid answer', () => {
    const brand = core.store.createBrand(brandJson as any);
    const workspace = core.store.workspaceFor(brand.id);
    const grouped = shoot(workspace.id, 'grouped');
    shoot(workspace.id, 'loose');
    const set = core.store.createSet(brand.id, 'Campaign');
    core.store.addToSet(set.id, [grouped]);

    const activity = core.store.recentActivity(brand.id);
    const byId = Object.fromEntries(activity.map((n) => [n.id, n.setNames]));
    expect(byId[grouped]).toEqual(['Campaign']);
    expect(activity.find((n) => n.prompt === 'loose')!.setNames).toEqual([]);
  });
});
