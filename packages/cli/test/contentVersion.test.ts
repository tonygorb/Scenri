import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTENT_TAG, CONTENT_VERSION, contentCacheStale, installContentArchive } from '../src/content/fetch.js';
import { contentCacheVersion } from '../src/content/overlay.js';

/**
 * The library archive is versioned, and every place that downloads it names
 * the same tag. Before this, the app fetched `content-latest` only when no
 * cache existed at all, so a catalog that named new pictures could run for
 * ever against an older library. The tag check reads the sources, the way
 * presenterViewParity.test.ts does, and asserts it found the lines first,
 * because a pattern that matches nothing agrees with everything.
 */
const repo = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(repo, p), 'utf8');

describe('the archive tag', () => {
  it('matches the version', () => {
    expect(CONTENT_TAG).toBe(`content-v${CONTENT_VERSION}`);
  });

  it('is the one CI and the publish job download', () => {
    const tags = [read('.github/workflows/ci.yml'), read('.github/workflows/publish.yml')].flatMap((text) =>
      [...text.matchAll(/gh release download (\S+)/g)].map((m) => m[1]),
    );
    expect(tags.length).toBe(3);
    expect(new Set(tags)).toEqual(new Set([CONTENT_TAG]));
  });

  it('is the one the hydration script names', () => {
    const script = read('packages/cli/scripts/pull-content.mts');
    expect(script).toContain('gh release download ${CONTENT_TAG}');
    expect(script).not.toMatch(/content-(latest|v\d)/);
  });
});

describe('the cache', () => {
  const dirs: string[] = [];
  const home = () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenri-content-'));
    dirs.push(dir);
    return dir;
  };
  const cache = (at: string, version: unknown) => {
    mkdirSync(join(at, 'content'), { recursive: true });
    writeFileSync(join(at, 'content', 'meta.json'), JSON.stringify({ version }));
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('is stale when missing, older, versionless or unreadable', () => {
    const at = home();
    expect(contentCacheStale({ SCENRI_HOME: at })).toBe(true);
    cache(at, CONTENT_VERSION - 1);
    expect(contentCacheVersion({ SCENRI_HOME: at })).toBe(CONTENT_VERSION - 1);
    expect(contentCacheStale({ SCENRI_HOME: at })).toBe(true);
    cache(at, undefined);
    expect(contentCacheStale({ SCENRI_HOME: at })).toBe(true);
    writeFileSync(join(at, 'content', 'meta.json'), '{');
    expect(contentCacheVersion({ SCENRI_HOME: at })).toBe(0);
  });

  it('is current at this version', () => {
    const at = home();
    cache(at, CONTENT_VERSION);
    expect(contentCacheStale({ SCENRI_HOME: at })).toBe(false);
  });

  it('is never second-guessed under a custom archive', () => {
    const at = home();
    cache(at, 1);
    expect(contentCacheStale({ SCENRI_HOME: at, SCENRI_CONTENT_URL: 'https://example.test/a.zip' })).toBe(false);
    expect(contentCacheStale({ SCENRI_HOME: at }, true)).toBe(false);
  });
});

describe('installing an archive', () => {
  const dirs: string[] = [];
  const scratch = () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenri-install-'));
    dirs.push(dir);
    return dir;
  };
  const archive = async (files: Record<string, string>) => {
    const zip = new JSZip();
    for (const [name, body] of Object.entries(files)) zip.file(name, body);
    return zip.generateAsync({ type: 'nodebuffer' });
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('replaces a real cache', async () => {
    const root = join(scratch(), 'content');
    mkdirSync(root);
    writeFileSync(join(root, 'old.jpg'), 'old');
    const refused = await installContentArchive(await archive({ 'meta.json': '{"version":2}', 'a.jpg': 'a' }), root);
    expect(refused).toBeNull();
    expect(readdirSync(root).sort()).toEqual(['a.jpg', 'meta.json']);
    expect(existsSync(`${root}.staging`)).toBe(false);
  });

  it('unlinks a linked cache and leaves the library it pointed at alone', async () => {
    const dir = scratch();
    const shared = join(dir, 'primary-content');
    mkdirSync(shared);
    writeFileSync(join(shared, 'meta.json'), '{"version":1}');
    writeFileSync(join(shared, 'keep.jpg'), 'keep');
    const root = join(dir, 'lane-home', 'content');
    mkdirSync(join(dir, 'lane-home'));
    symlinkSync(shared, root);

    const refused = await installContentArchive(await archive({ 'meta.json': '{"version":2}', 'a.jpg': 'a' }), root);
    expect(refused).toBeNull();
    expect(readdirSync(shared).sort()).toEqual(['keep.jpg', 'meta.json']);
    expect(readFileSync(join(shared, 'meta.json'), 'utf8')).toBe('{"version":1}');
    expect(readdirSync(root).sort()).toEqual(['a.jpg', 'meta.json']);
  });

  it('refuses an archive with no marker and keeps the old cache', async () => {
    const root = join(scratch(), 'content');
    mkdirSync(root);
    writeFileSync(join(root, 'meta.json'), '{"version":1}');
    const refused = await installContentArchive(await archive({ 'a.jpg': 'a' }), root);
    expect(refused).toBe('archive carries no meta.json');
    expect(readdirSync(root)).toEqual(['meta.json']);
    expect(existsSync(`${root}.staging`)).toBe(false);
  });
});
