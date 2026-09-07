import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LANES,
  assertSlug,
  ensureLane,
  gitDirs,
  laneEnv,
  laneEnvFor,
  lowestFreeLane,
  slugOf,
  usedLanes,
} from '../scripts/worktree.js';

const made: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sc-wt-'));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A primary and its linked worktrees, laid out exactly as git does it, without a git binary. */
function fakeRepo(names = ['wt']) {
  const root = tmp();
  const primary = join(root, 'primary');
  const common = join(primary, '.git');
  mkdirSync(common, { recursive: true });
  const links: Record<string, { wt: string; gitDir: string }> = {};
  for (const name of names) {
    const gitDir = join(common, 'worktrees', name);
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(gitDir, 'commondir'), '../..\n');
    const wt = join(root, name);
    mkdirSync(wt);
    writeFileSync(join(wt, '.git'), `gitdir: ${gitDir}\n`);
    links[name] = { wt, gitDir };
  }
  return { primary, common, links };
}

describe('lanes', () => {
  it('maps a lane to its ports, its in-tree home and the two silencing flags', () => {
    expect(laneEnvFor(1, '/w/.scenri-home')).toEqual({
      SCENRI_PORT: '4748',
      SCENRI_API: 'http://127.0.0.1:4748',
      SCENRI_UI_PORT: '5174',
      SCENRI_HOME: '/w/.scenri-home',
      SCENRI_E2E_PORT: '6100',
      SCENRI_NO_DESKTOP: '1',
      SCENRI_NO_OPEN: '1',
    });
  });

  it('keeps every lane clear of the ports the repo already uses', () => {
    // 4747 owner; 4757..4760 e2e workers; 4767..4787 updates.spec fixtures and
    // their probe; 4791/4792 and 4795/4796 the update scripts; 4798+ the perf
    // rig; 5173 the owner's Vite. CI's Windows smoke uses 4759.
    const taken = new Set([4747, 5173, 4791, 4792, 4795, 4796]);
    for (let p = 4757; p <= 4800; p++) taken.add(p);
    const bands = [];
    for (let lane = 1; lane <= LANES; lane++) {
      const env = laneEnvFor(lane, '/h');
      expect(taken.has(Number(env.SCENRI_PORT))).toBe(false);
      expect(taken.has(Number(env.SCENRI_UI_PORT))).toBe(false);
      const base = Number(env.SCENRI_E2E_PORT);
      expect(base).toBeGreaterThanOrEqual(6000);
      // four harness workers at base..base+3, updates.spec at base+10..base+86
      bands.push([base, base + 86]);
    }
    for (let i = 1; i < bands.length; i++) expect(bands[i][0]).toBeGreaterThan(bands[i - 1][1]);
  });

  it('hands out the lowest free lane and refuses when all nine are taken', () => {
    expect(lowestFreeLane(new Set())).toBe(1);
    expect(lowestFreeLane(new Set([1, 2, 4]))).toBe(3);
    expect(() => lowestFreeLane(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(/all 9 lanes/);
  });
});

describe('slugs', () => {
  it('turns a branch into a directory name', () => {
    expect(slugOf('feat/attach-picker')).toBe('feat-attach-picker');
    expect(slugOf('release-please--branches--main')).toBe('release-please--branches--main');
  });

  it('refuses dist, which installKind.ts would read as a built install', () => {
    expect(() => assertSlug('dist')).toThrow(/dist/);
    expect(() => assertSlug('has space')).toThrow(/directory name/);
    expect(assertSlug('fix-thumb-cache')).toBe('fix-thumb-cache');
  });
});

describe('detection', () => {
  it('sees the primary as not linked and gives it no lane', () => {
    const repo = fakeRepo();
    expect(gitDirs(repo.primary)).toEqual({ linked: false, gitDir: repo.common, commonDir: repo.common });
    expect(ensureLane(repo.primary)).toBeNull();
    expect(laneEnv(repo.primary)).toEqual({});
  });

  it('returns nothing for a directory that is not a checkout', () => {
    expect(gitDirs(tmp())).toBeNull();
    expect(laneEnv(tmp())).toEqual({});
    expect(laneEnv(join(tmp(), 'missing'))).toEqual({});
  });

  it('resolves a linked worktree to its own git dir and the common dir', () => {
    const repo = fakeRepo();
    expect(gitDirs(repo.links.wt.wt)).toEqual({ linked: true, gitDir: repo.links.wt.gitDir, commonDir: repo.common });
  });

  it('assigns a lane once, reads it back, and gives the next worktree the next lane', () => {
    const repo = fakeRepo(['a', 'b']);
    expect(ensureLane(repo.links.a.wt)).toBe(1);
    expect(readFileSync(join(repo.links.a.gitDir, 'scenri-lane'), 'utf8')).toBe('1\n');
    expect(ensureLane(repo.links.a.wt)).toBe(1);
    expect(ensureLane(repo.links.b.wt)).toBe(2);
    expect([...usedLanes(repo.common)].sort()).toEqual([1, 2]);
  });

  it('ignores a lane file that is not a lane', () => {
    const repo = fakeRepo(['a', 'b']);
    writeFileSync(join(repo.links.a.gitDir, 'scenri-lane'), 'seventeen\n');
    expect(ensureLane(repo.links.b.wt)).toBe(1);
  });

  it('gives a linked worktree the lane variables and an in-tree home', () => {
    const repo = fakeRepo();
    const env = laneEnv(repo.links.wt.wt);
    expect(env.SCENRI_PORT).toBe('4748');
    expect(env.SCENRI_HOME).toBe(join(repo.links.wt.wt, '.scenri-home'));
  });
});
