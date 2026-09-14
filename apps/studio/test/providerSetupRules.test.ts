import { describe, expect, it } from 'vitest';
import { conflictSentence, repairNote, repairedNote, stepState } from '../src/views/providerSetupRules.js';

/**
 * The stepper is the whole message in one glance, so which dots are lit is a
 * claim about the machine and worth pinning.
 */

describe('stepState', () => {
  it('lights nothing before anything is installed', () => {
    expect(stepState('not-installed')).toEqual({ installed: false, signedIn: false, connected: false, now: 'install' });
  });

  it('lights install once there is a codex to sign into', () => {
    expect(stepState('not-authenticated')).toMatchObject({ installed: true, signedIn: false, now: 'signin' });
  });

  // You did both your jobs; the last one is not your fault.
  it('lights install and sign in for a credential conflict, and sits on connect', () => {
    expect(stepState('env-conflict')).toEqual({ installed: true, signedIn: true, connected: false, now: 'connect' });
    expect(stepState('repairing')).toEqual({ installed: true, signedIn: true, connected: false, now: 'connect' });
  });

  it('lights all three only when a real run proved it', () => {
    expect(stepState('ready')).toEqual({ installed: true, signedIn: true, connected: true, now: null });
  });

  // Unverified claims nothing, so it must not claim a step either.
  it('claims nothing when the check could not tell', () => {
    expect(stepState('unverified')).toEqual({ installed: false, signedIn: false, connected: false, now: null });
  });

  it('keeps install lit for an out-of-date codex, because one is installed', () => {
    expect(stepState('update-needed')).toMatchObject({ installed: true, signedIn: false, connected: false });
  });
});

describe('the words for a conflicting credential', () => {
  it('names one variable, or several, in plain English', () => {
    expect(conflictSentence(['CODEX_API_KEY'])).toBe('the CODEX_API_KEY variable');
    expect(conflictSentence(['CODEX_API_KEY', 'OPENAI_API_KEY'])).toBe(
      'the CODEX_API_KEY and OPENAI_API_KEY variables',
    );
    expect(conflictSentence([])).toBe('that key');
  });

  it('promises that nothing on the machine changes, and that it can be undone', () => {
    const note = repairNote(['CODEX_API_KEY']);
    expect(note).toContain('CODEX_API_KEY');
    expect(note).toContain('Nothing on your computer changes');
    expect(note).toContain('undo');
  });

  it('says plainly what a repaired machine is doing', () => {
    expect(repairedNote(['CODEX_API_KEY'])).toContain('without the CODEX_API_KEY variable');
  });
});
