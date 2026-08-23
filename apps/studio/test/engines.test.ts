import { describe, it, expect } from 'vitest';
import { effectiveEngineId, engineMeta, engineTitle, FALLBACK_ENGINE_ID, perImage, rowAction } from '../src/engines/active.js';
import { KEY_PROVIDERS, keyProviderFor } from '../src/engines/providers.js';

describe('engineTitle', () => {
  it('drops the BYOK suffix, which is our billing word and not a provider name', () => {
    expect(engineTitle('OpenRouter (BYOK)')).toBe('OpenRouter');
    expect(engineTitle('fal.ai (BYOK)')).toBe('fal.ai');
    expect(engineTitle('replicate (byok)')).toBe('replicate');
  });

  it('leaves a name that never carried one alone', () => {
    expect(engineTitle('Codex CLI')).toBe('Codex CLI');
    expect(engineTitle('Demo')).toBe('Demo');
  });

  it('only strips the suffix, never the same letters mid-name', () => {
    expect(engineTitle('BYOK Images')).toBe('BYOK Images');
  });
});

describe('effectiveEngineId', () => {
  const usable = [{ id: 'openrouter' }, { id: 'replicate' }];

  it('keeps a stored pick that is still connected', () => {
    expect(effectiveEngineId(usable, 'replicate')).toBe('replicate');
  });

  it('falls to the first usable engine when the stored one went away', () => {
    expect(effectiveEngineId(usable, 'fal')).toBe('openrouter');
  });

  it('falls to Codex when nothing at all is connected, which is also a first run', () => {
    expect(effectiveEngineId([], 'replicate')).toBe(FALLBACK_ENGINE_ID);
    expect(effectiveEngineId([], FALLBACK_ENGINE_ID)).toBe('codex-cli');
  });
});

describe('rowAction', () => {
  it('keeps the key-provider verbs exactly as they were', () => {
    expect(rowAction({ id: 'openrouter', available: true, code: null }, true)).toBe('Manage');
    expect(rowAction({ id: 'openrouter', available: false, code: null }, true)).toBe('Connect');
  });

  it('gives a connected Codex a Manage door back into its own setup', () => {
    expect(rowAction({ id: FALLBACK_ENGINE_ID, available: true, code: null }, false)).toBe('Manage');
  });

  it('gives a connected non-key engine that is not Codex no button at all', () => {
    expect(rowAction({ id: 'demo', available: true, code: null }, false)).toBeNull();
  });

  it('maps every setup code to its one verb, unknown included', () => {
    expect(rowAction({ id: FALLBACK_ENGINE_ID, available: false, code: 'not-installed' }, false)).toBe('Set up');
    expect(rowAction({ id: FALLBACK_ENGINE_ID, available: false, code: 'not-authenticated' }, false)).toBe('Set up');
    expect(rowAction({ id: FALLBACK_ENGINE_ID, available: false, code: 'unverified' }, false)).toBe('Set up');
    expect(rowAction({ id: FALLBACK_ENGINE_ID, available: false, code: 'update-needed' }, false)).toBe('Update');
    expect(rowAction({ id: 'demo', available: false, code: null }, false)).toBeNull();
  });
});

describe('perImage', () => {
  it('trims trailing zeroes so an estimate reads as itself', () => {
    expect(perImage(0.04)).toBe('0.04');
    expect(perImage(0.003)).toBe('0.003');
    expect(perImage(0.1)).toBe('0.1');
    expect(perImage(1)).toBe('1');
  });
});

describe('engineMeta', () => {
  it('prices an engine we bill through', () => {
    expect(engineMeta({ free: false, localOnly: false, perGeneration: 0.04 })).toBe('$0.04 / image');
  });

  it('never says free of Codex: the images spend a ChatGPT plan the user pays for', () => {
    const meta = engineMeta({ free: true, localOnly: true, perGeneration: 0 });
    expect(meta).toBe('Runs on your ChatGPT plan');
    expect(meta).not.toMatch(/free/i);
  });

  it('says what a costless remote engine is, without pricing it', () => {
    expect(engineMeta({ free: true, localOnly: false, perGeneration: 0 })).toBe('No cost per image');
  });
});

describe('the provider table', () => {
  /**
   * These are the only three fields `PUT /api/settings` accepts (SECRET_KEYS in
   * packages/cli/src/server.ts). A typo here is a key saved to a row nothing
   * reads, which fails silently: the field clears, and the provider stays
   * disconnected with no error anywhere.
   */
  it('names the settings keys the server actually accepts', () => {
    expect(KEY_PROVIDERS.map((p) => p.settingKey)).toEqual(['openrouter_api_key', 'replicate_api_token', 'fal_key']);
  });

  it('maps each key to its engine id, and finds it by that id', () => {
    expect(keyProviderFor('openrouter')?.settingKey).toBe('openrouter_api_key');
    expect(keyProviderFor('replicate')?.settingKey).toBe('replicate_api_token');
    expect(keyProviderFor('fal')?.settingKey).toBe('fal_key');
  });

  it('does not claim Codex, whose setup is an install and a sign-in', () => {
    expect(keyProviderFor('codex-cli')).toBeUndefined();
    expect(keyProviderFor('demo')).toBeUndefined();
  });

  it('sends everyone somewhere they can actually issue a key', () => {
    for (const p of KEY_PROVIDERS) expect(p.keysUrl).toMatch(/^https:\/\//);
  });
});
