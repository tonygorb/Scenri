/**
 * The one question the first run asks, once, after Scenri is already open in
 * the browser: whether to put an icon on the Desktop. The gate is a pure
 * function of what serve already knows; the prompt reads one line with
 * readline in cooked mode, so the server keeps running underneath it and
 * Ctrl-C still stops it. "Not now" is remembered in the settings table, and
 * Settings > About keeps offering the icon regardless.
 */
import { createInterface } from 'node:readline';
import type { InstallKind } from '../installKind.js';
import type { InstallResult } from './install.js';

export function shouldOfferDesktop(i: {
  env: NodeJS.ProcessEnv;
  stdinTTY: boolean;
  stdoutTTY: boolean;
  platform: NodeJS.Platform;
  installKind: InstallKind;
  launcherInstalled: boolean;
  declined: boolean;
}): boolean {
  if (i.env.SCENRI_NO_DESKTOP === '1') return false;
  if (!i.stdinTTY || !i.stdoutTTY) return false;
  if (i.env.CI) return false;
  // A shell on another machine has a TTY too; its Desktop is not the one in front of the person.
  if (i.env.SSH_TTY) return false;
  if (i.platform !== 'darwin' && i.platform !== 'win32') return false;
  if (i.installKind === 'dev') return false;
  if (i.launcherInstalled) return false;
  if (i.declined) return false;
  return true;
}

export const OFFER_QUESTION = '  Add Scenri to your desktop? Then you can open it without a terminal. [Y/n] ';

export async function offerDesktop(deps: {
  ask: (question: string) => Promise<string>;
  add: () => Promise<InstallResult>;
  decline: () => void;
  say: (line: string) => void;
}): Promise<void> {
  let answer: string;
  try {
    answer = (await deps.ask(OFFER_QUESTION)).trim().toLowerCase();
  } catch {
    return; // stdin went away: nobody to answer, nothing to remember
  }
  if (answer === '' || answer.startsWith('y')) {
    await deps.add();
    return;
  }
  deps.decline();
  deps.say('  Not now. Add it later with: npx scenri desktop, or from Settings > About.');
}

/** One line from the terminal. Cooked mode: no raw keys, so Ctrl-C is still a signal. */
export function askOnTerminal(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    let done = false;
    rl.question(question, (answer) => {
      done = true;
      rl.close();
      resolve(answer);
    });
    rl.once('close', () => {
      if (!done) reject(new Error('stdin closed'));
    });
  });
}
