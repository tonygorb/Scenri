/**
 * The one question the first run asks, once, after Scenri is already open in
 * the browser: whether to put an icon on the Desktop. The gate is a pure
 * function of what serve already knows; the prompt reads one line with
 * readline in cooked mode, so the server keeps running underneath it and
 * Ctrl-C still stops it. "Not now" is remembered in the settings table, and
 * Settings > About keeps offering the icon regardless.
 *
 * The hard invariant, learned from a tester on 0.9.2 whose "Y" killed a
 * running Scenri: answering yes ATTEMPTS the icon, answering no SKIPS it, and
 * neither outcome may stop the server. The icon is a convenience; the app is
 * not conditional on it.
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
const LATER_LINE = '  Not now. Add it later with: npx scenri desktop, or from Settings > About.';
const STILL_RUNNING_LINE = '  Scenri is running anyway. Add the icon later from Settings > About.';

/** Nobody is at the keyboard forever. After this the prompt gives up and the boot moves on. */
const ASK_TIMEOUT_MS = 120_000;

/**
 * What a typed answer means. Empty is yes because the prompt reads [Y/n], and
 * the capital is the default. Anything that does not start with a y is a no,
 * including a word we never thought of: guessing "maybe" means yes would put a
 * file on someone's Desktop they did not ask for.
 */
export function parseOfferAnswer(raw: string): 'yes' | 'no' {
  const answer = raw.trim().toLowerCase();
  if (answer === '' || answer.startsWith('y')) return 'yes';
  return 'no';
}

export async function offerDesktop(deps: {
  ask: (question: string) => Promise<string>;
  add: () => Promise<InstallResult>;
  decline: () => void;
  say: (line: string) => void;
}): Promise<void> {
  let answer: string;
  try {
    answer = await deps.ask(OFFER_QUESTION);
  } catch {
    // stdin went away, or nobody answered. Neither is a refusal, so nothing is
    // remembered and the offer comes back next time.
    deps.say('');
    deps.say(LATER_LINE);
    return;
  }
  if (parseOfferAnswer(answer) === 'no') {
    deps.decline();
    deps.say(LATER_LINE);
    return;
  }
  // Yes means attempt. It does not mean the attempt succeeds, and a failed
  // attempt is a printed sentence, never an exit.
  try {
    const res = await deps.add();
    if (!res.ok) deps.say(STILL_RUNNING_LINE);
  } catch {
    // addToDesktop already answers rather than throwing; this is the belt to
    // its braces, so a future edit there cannot reach the process-level catch.
    deps.say('  Could not add the desktop icon.');
    deps.say(STILL_RUNNING_LINE);
  }
}

/**
 * One line from the terminal. Cooked mode: no raw keys, so Ctrl-C is still a
 * signal. Bounded, because this runs after the browser is already open: a
 * console that never delivers a line must not hold the prompt open forever.
 */
export function askOnTerminal(
  question: string,
  timeoutMs = ASK_TIMEOUT_MS,
  io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } = {
    input: process.stdin,
    output: process.stdout,
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: io.input, output: io.output, terminal: false });
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      rl.close();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('nobody answered'))), timeoutMs);
    timer.unref?.();
    rl.question(question, (answer) => finish(() => resolve(answer)));
    rl.once('close', () => {
      if (!done) finish(() => reject(new Error('stdin closed')));
    });
  });
}
