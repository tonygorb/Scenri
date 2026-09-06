import { describe, it, expect } from 'vitest';
import { offerDesktop, shouldOfferDesktop } from '../src/desktop/offer.js';

/**
 * The one question the first run asks, and the gate in front of it. The gate
 * is a pure function of what serve already knows; the prompt talks through an
 * injected `ask`, so no test ever touches stdin.
 */

const ok = {
  env: {} as NodeJS.ProcessEnv,
  stdinTTY: true,
  stdoutTTY: true,
  platform: 'darwin' as NodeJS.Platform,
  installKind: 'npx' as const,
  launcherInstalled: false,
  declined: false,
};

describe('shouldOfferDesktop', () => {
  it('asks a person at a terminal on a supported OS with nothing installed and no earlier no', () => {
    expect(shouldOfferDesktop(ok)).toBe(true);
    expect(shouldOfferDesktop({ ...ok, platform: 'win32', installKind: 'global' })).toBe(true);
    expect(shouldOfferDesktop({ ...ok, installKind: 'managed' })).toBe(true);
  });

  it.each([
    ['SCENRI_NO_DESKTOP', { env: { SCENRI_NO_DESKTOP: '1' } }],
    ['CI', { env: { CI: 'true' } }],
    ['an SSH session', { env: { SSH_TTY: '/dev/pts/1' } }],
    ['no stdin tty', { stdinTTY: false }],
    ['no stdout tty', { stdoutTTY: false }],
    ['Linux', { platform: 'linux' as NodeJS.Platform }],
    ['a source checkout', { installKind: 'dev' as const }],
    ['an installed launcher', { launcherInstalled: true }],
    ['an earlier Not now', { declined: true }],
  ])('stays quiet for %s', (_name, over) => {
    expect(shouldOfferDesktop({ ...ok, ...over })).toBe(false);
  });
});

function prompt(answer: string | null) {
  const calls = { added: 0, declined: 0, said: [] as string[], asked: [] as string[] };
  const deps = {
    ask: async (q: string) => {
      calls.asked.push(q);
      if (answer === null) throw new Error('stdin closed');
      return answer;
    },
    add: async () => {
      calls.added++;
      return { ok: true as const, kind: 'macos-app' as const, path: '/Users/t/Desktop/Scenri.app' };
    },
    decline: () => {
      calls.declined++;
    },
    say: (line: string) => {
      calls.said.push(line);
    },
  };
  return { deps, calls };
}

describe('offerDesktop', () => {
  it('asks one plain question with yes as the default', async () => {
    const { deps, calls } = prompt('');
    await offerDesktop(deps);
    expect(calls.asked).toEqual(['  Add Scenri to your desktop? Then you can open it without a terminal. [Y/n] ']);
    expect(calls.added).toBe(1);
    expect(calls.declined).toBe(0);
  });

  it.each(['y', 'Y', 'yes', ' Yes '])('adds on %j', async (answer) => {
    const { deps, calls } = prompt(answer);
    await offerDesktop(deps);
    expect(calls.added).toBe(1);
  });

  it.each(['n', 'N', 'no', 'later'])('remembers %j as Not now and says where to find it later', async (answer) => {
    const { deps, calls } = prompt(answer);
    await offerDesktop(deps);
    expect(calls.added).toBe(0);
    expect(calls.declined).toBe(1);
    expect(calls.said.join('\n')).toContain('npx scenri desktop');
    expect(calls.said.join('\n')).toContain('Settings > About');
  });

  it('does nothing when stdin goes away mid-question', async () => {
    const { deps, calls } = prompt(null);
    await offerDesktop(deps);
    expect(calls.added).toBe(0);
    expect(calls.declined).toBe(0);
  });
});
