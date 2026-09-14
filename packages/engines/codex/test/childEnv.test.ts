import { describe, expect, it } from 'vitest';
import { buildChildEnv } from '../src/childEnv.js';

/**
 * Scenri never changes the machine it runs on. Dropping a variable means
 * dropping it from one child's environment, for that child only.
 */

describe('buildChildEnv', () => {
  it('is a copy, so the parent keeps everything it had', () => {
    const parent = { PATH: '/usr/bin', CODEX_API_KEY: 'sk-proj-real' };
    const child = buildChildEnv(parent, ['CODEX_API_KEY']);
    expect(child.CODEX_API_KEY).toBeUndefined();
    expect(parent.CODEX_API_KEY).toBe('sk-proj-real');
  });

  it('never touches process.env, whatever it is asked to drop', () => {
    const before = process.env.PATH;
    buildChildEnv(process.env, ['PATH', 'HOME', 'CODEX_API_KEY']);
    expect(process.env.PATH).toBe(before);
  });

  // Windows environment names are case-insensitive, so an exact-match drop
  // would sail straight past a machine carrying Codex_Api_Key.
  it.each(['CODEX_API_KEY', 'codex_api_key', 'Codex_Api_Key'])('drops %s whatever its case', (name) => {
    const child = buildChildEnv({ [name]: 'x', PATH: '/usr/bin' }, ['CODEX_API_KEY']);
    expect(Object.keys(child)).toEqual(['PATH']);
  });

  it('keeps everything codex actually needs to start', () => {
    const parent = {
      PATH: '/usr/bin',
      HOME: '/Users/sam',
      USERPROFILE: 'C:\\Users\\Sam',
      CODEX_HOME: '/Users/sam/.codex',
      APPDATA: 'C:\\Users\\Sam\\AppData\\Roaming',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\system32\\cmd.exe',
      CODEX_API_KEY: 'sk-proj-stale',
    };
    const child = buildChildEnv(parent, ['CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_API_KEY']);
    expect(child).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/sam',
      USERPROFILE: 'C:\\Users\\Sam',
      CODEX_HOME: '/Users/sam/.codex',
      APPDATA: 'C:\\Users\\Sam\\AppData\\Roaming',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    });
  });

  it('dropping nothing is still a copy, not the same object', () => {
    const parent = { PATH: '/usr/bin' };
    const child = buildChildEnv(parent, []);
    expect(child).toEqual(parent);
    expect(child).not.toBe(parent);
  });
});
