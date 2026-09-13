import type { CodexSetupState } from '../apiTypes.js';

/**
 * What the setup wizard's stepper shows, and how it talks about a credential
 * that is in the way. Pure, so the wording and the arithmetic can be tested
 * without mounting a dialog.
 */

/** Every state the codex pane can be in, including the two it drives itself. */
export type Phase = 'checking' | CodexSetupState | 'installing' | 'signing-in' | 'repairing' | 'no-plan';

export interface StepState {
  installed: boolean;
  signedIn: boolean;
  connected: boolean;
  now: 'install' | 'signin' | 'connect' | null;
}

/**
 * Three things to do, and people count them: install, sign in, connect.
 *
 * The third exists because the first two can both be done and generation can
 * still fail. env-conflict is exactly that shape, so it lights Install and
 * Sign in and sits on Connect: you did both your jobs, the last one is not
 * your fault.
 */
export function stepState(phase: Phase): StepState {
  const installed =
    phase === 'not-authenticated' ||
    phase === 'signing-in' ||
    phase === 'update-needed' ||
    phase === 'env-conflict' ||
    phase === 'repairing' ||
    phase === 'ready';
  const signedIn = phase === 'env-conflict' || phase === 'repairing' || phase === 'ready';
  const connected = phase === 'ready';
  const now: StepState['now'] =
    phase === 'not-installed' || phase === 'installing'
      ? 'install'
      : phase === 'not-authenticated' || phase === 'signing-in'
        ? 'signin'
        : phase === 'env-conflict' || phase === 'repairing'
          ? 'connect'
          : null;
  return { installed, signedIn, connected, now };
}

/** "the CODEX_API_KEY variable" / "the CODEX_API_KEY and OPENAI_API_KEY variables" */
export function conflictSentence(keys: readonly string[]): string {
  if (keys.length === 0) return 'that key';
  if (keys.length === 1) return `the ${keys[0]} variable`;
  return `the ${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]} variables`;
}

/** What the note under the repair button says. Names the variable; never its value. */
export function repairNote(keys: readonly string[]): string {
  return (
    `Scenri will start Codex without ${conflictSentence(keys)}. ` +
    'Nothing on your computer changes, and you can undo this here later.'
  );
}

/** What the note on a repaired machine says, so the state is visible rather than silent. */
export function repairedNote(keys: readonly string[]): string {
  return `Scenri is starting Codex without ${conflictSentence(keys)} on this computer.`;
}
