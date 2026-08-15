import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { clip, sanitiseUrl, scrub, scrubDeep } from '../src/feedback/scrub.js';

/** Every scene, presenter and demo-product id that actually ships. */
function realCuratedIds(): string[] {
  const root = join(__dirname, '..', '..', '..', 'templates');
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const d = join(root, dir.name);
    for (const f of readdirSync(d)) {
      if (f.endsWith('.json')) out.push(f.replace(/\.json$/, ''));
    }
  }
  return out;
}

describe('scrub', () => {
  it('redacts every provider key shape scenri can see', () => {
    expect(scrub('key sk-or-v1-abcdef0123456789abcdef0123456789 rejected')).not.toContain('abcdef');
    expect(scrub('OPENAI sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toContain('[redacted]');
    expect(scrub('token r8_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA bad')).toContain('[redacted]');
    expect(scrub('fal_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toContain('[redacted]');
    expect(scrub('ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toContain('[redacted]');
  });

  it('rewrites a home directory, which carries the OS username', () => {
    expect(scrub('ENOENT: /Users/tonygorb/.scenri/images')).toBe('ENOENT: ~/.scenri/images');
    expect(scrub('at /home/mara/.scenri/scenri.db')).toBe('at ~/.scenri/scenri.db');
    expect(scrub('C:\\Users\\Mara\\.scenri')).toBe('~\\.scenri');
  });

  it('keeps the two opaque strings that are useful context, drops the rest', () => {
    // an image hash is content-addressed and worth having
    const hash = 'a'.repeat(32);
    expect(scrub(`/api/images/${hash}`)).toContain(hash);
    // a brand id is a UUID and is how the owner asks a precise question
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(scrub(`brand ${uuid}`)).toContain(uuid);
    // a curated catalog id is the most useful field in a report and must survive
    expect(scrub('scene interiors-marble-kitchen-counter')).toContain('interiors-marble-kitchen-counter');
    expect(scrub('amble-roasting-co-ethiopia-light-roast')).toContain('amble-roasting-co-ethiopia-light-roast');
    // the access token is 24 random bytes as base64url, which is exactly 32
    // characters -- the same length as an image hash. Hence the allow-list.
    expect(scrub('t=Xy9-_ABCDEFGHIJKLMNOPQRSTUVwxyzAB')).toContain('[redacted]');
    expect(scrub('7NkQ2mVx8pLd4RtY6wZa1BcE3fGh5JiK')).toBe('[redacted]');
  });

  it('never eats a real curated id: every one in templates/ survives', () => {
    // The allow-list is a heuristic, so it is checked against the whole real
    // catalog rather than a couple of hand-picked examples.
    const ids = realCuratedIds();
    expect(ids.length).toBeGreaterThan(20);
    const eaten = ids.filter((id) => !scrub(id).includes(id));
    expect(eaten).toEqual([]);
  });

  it('strips the access token from any URL, and the origin with it', () => {
    expect(sanitiseUrl('http://192.168.1.9:4747/nalla/create?t=Xy9-_ABCDEFGHIJKLMNOPQRSTUVwxyz')).toBe('/nalla/create');
    expect(sanitiseUrl('/nalla/create?settings=engines&t=secret')).toBe('/nalla/create?settings=engines');
    // not a URL at all: still must not hand back the token
    expect(sanitiseUrl('nonsense?t=secret')).not.toContain('secret');
  });

  it('keeps only the query keys that describe which view was open', () => {
    const out = sanitiseUrl('/n/create?tab=all&branch=x&nope=1&t=zz');
    expect(out).toContain('tab=all');
    expect(out).toContain('branch=x');
    expect(out).not.toContain('nope');
  });

  it('walks a whole payload, not just top-level strings', () => {
    const before = {
      comment: 'broke at /Users/tonygorb/.scenri',
      errors: [{ message: 'key sk-or-v1-abcdef0123456789abcdef0123456789 rejected' }],
      nested: { deep: ['/home/mara/x'] },
      keep: 42,
    };
    const after = scrubDeep(before);
    expect(JSON.stringify(after)).not.toContain('tonygorb');
    expect(JSON.stringify(after)).not.toContain('abcdef0123456789');
    expect(JSON.stringify(after)).not.toContain('/home/mara');
    expect(after.keep).toBe(42);
  });

  it('clips without hiding that it clipped', () => {
    expect(clip('abcdef', 3)).toBe('abc…');
    expect(clip('ab', 3)).toBe('ab');
  });
});
