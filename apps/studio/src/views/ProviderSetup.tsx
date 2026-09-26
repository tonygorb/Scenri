import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Spinner } from '@radix-ui/themes';
import { ArrowRight, ArrowsClockwise, ArrowSquareOut, Check, Copy, Key, Warning, X } from '@phosphor-icons/react';
import { api, type EngineInfo, type SetupPlatform } from '../api.js';
import { useDialogParam } from '../app/AppShell.js';
import { useOpenSetup } from '../app/dialogs.js';
import { engineTitle } from '../engines/active.js';
import { EngineMark, engineTile, keyProviderFor, type KeyProvider } from '../engines/providers.jsx';
import { Confirm } from '../Confirm.js';
import { DialogSheet, SheetClose, SheetTitle } from '../layout/DialogSheet.js';
import { type Phase, repairNote, repairedNote, stepState } from './providerSetupRules.js';

/**
 * Connecting one provider: how a person who has never opened a terminal gets
 * Scenri generating.
 *
 * Two shapes of setup exist, and both live here so that connecting anything
 * feels like the same act. Codex is a local helper to install and sign into,
 * which is the two-step flow below. Everything else is a key to paste, which
 * used to happen in a field sitting open in the settings list — a form where an
 * overview belonged.
 *
 * The Codex path only ever runs official commands: `npm install -g
 * @openai/codex` and `codex login`. Sign-in happens in the user's own browser
 * and no credential passes through Scenri.
 */

/** How long to keep polling after `codex login` opens a browser tab. */
const LOGIN_POLL_MS = 2_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

export function ProviderSetup({ engines, onSaved }: { engines: EngineInfo[]; onSaved: () => void }) {
  const setup = useDialogParam('setup');
  const close = setup.close;
  const engineId = setup.value;
  const provider = engineId ? keyProviderFor(engineId) : undefined;
  const isCodex = engineId === 'codex-cli';
  // An unknown id in the URL opens nothing rather than a dialog that cannot
  // describe what it is setting up.
  const open = Boolean(provider) || isCodex;
  const engine = engines.find((e) => e.id === engineId);
  // A key is typed only on the computer running Scenri: the server refuses one
  // from a phone. Asked once, as the studio loads, so a phone never opens onto
  // a field it cannot use; until the answer comes the field is there.
  const [thisComputer, setThisComputer] = useState(true);
  useEffect(() => {
    let alive = true;
    api
      .version()
      .then((v) => alive && setThisComputer(v.thisComputer !== false))
      .catch(() => {
        /* the server still refuses a key from a phone */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Settings' own shell, since this opens from it and over it: the same head,
  // and on a phone the same sheet.
  return (
    <DialogSheet
      open={open}
      className="sc-setup"
      maxWidth="520px"
      onDismiss={close}
      // A key pane's field is its whole business, so it takes the first focus.
      // Focused here, once this sheet's trap is the active one: focused on the
      // pane's own mount, Settings' trap underneath was still live and pulled
      // focus back to its Connect button, outside this sheet.
      onOpenAutoFocus={
        provider && thisComputer
          ? (e) => {
              e.preventDefault();
              (e.target as HTMLElement).querySelector<HTMLInputElement>('.sc-setup-key input')?.focus();
            }
          : undefined
      }
    >
      {provider ? (
        <KeyPane
          provider={provider}
          name={engine ? engineTitle(engine.displayName) : provider.engineId}
          connected={Boolean(engine?.available)}
          thisComputer={thisComputer}
          onSaved={onSaved}
          onDone={close}
        />
      ) : (
        <CodexPane engines={engines} onSaved={onSaved} onDone={close} />
      )}
    </DialogSheet>
  );
}

/**
 * The dialog's own title bar. No mark up here: beside our own heading a
 * provider's logo reads as a badge of approval from them, so it sits downstairs
 * with the sentence that names it instead.
 */
function SetupHead({ title }: { title: string }) {
  return (
    <div className="sc-newdlg-head sc-setup-head">
      <SheetTitle className="sc-newdlg-title sc-setup-title">{title}</SheetTitle>
      <SheetClose>
        <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
          <X size={16} />
        </button>
      </SheetClose>
    </div>
  );
}

/**
 * One field, because that is the whole of this provider's setup.
 *
 * The key is write-only end to end: it is typed here, sent once, and read back
 * by nobody. `GET /api/settings` answers with booleans, so even this dialog
 * cannot show what is stored, which is why replacing is offered and revealing
 * is not.
 */
function KeyPane({
  provider,
  name,
  connected,
  thisComputer,
  onSaved,
  onDone,
}: {
  provider: KeyProvider;
  name: string;
  connected: boolean;
  thisComputer: boolean;
  onSaved: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromEnv, setFromEnv] = useState(false);

  const save = async () => {
    const key = value.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveSettings({ [provider.settingKey]: key });
      setValue('');
      onSaved();
      onDone();
    } catch (err) {
      // This used to be a try/finally with no catch, so a rejected save threw
      // into the console and the dialog said nothing at all.
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveSettings({ [provider.settingKey]: '' });
      // A key can also arrive from the environment, and clearing the stored one
      // does not touch it. Rather than claim a disconnect that did not happen,
      // ask again and say where the key that is left comes from.
      const present = await api.settings();
      onSaved();
      if (present[provider.settingKey]) {
        setFromEnv(true);
        return;
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SetupHead title={connected ? `${name} key` : `Connect ${name}`} />
      <div className="sc-setup-body">
        {/* The row's own tile, carried into the dialog, so this reads as that
            row opened rather than as a new place. */}
        <div className="sc-setup-intro">
          <Subject
            engineId={provider.engineId}
            name={name}
            state={connected ? 'Connected' : 'Not connected'}
            ready={connected}
          />
          <p className="sc-setup-lead">
            {!thisComputer
              ? 'Keys are added on the computer running Scenri.'
              : connected
                ? `A key is saved for ${name}. Paste a new one to replace it, or disconnect to remove it from this computer.`
                : `Paste a key from ${name}. It is stored in your library folder on this computer, sent only to ${name}, and never shown again.`}
          </p>
        </div>

        {thisComputer && (
          <form
            className="sc-setup-key"
            onSubmit={(ev) => {
              ev.preventDefault();
              void save();
            }}
          >
            <input
              className="sc-in"
              type="password"
              placeholder={provider.hint}
              value={value}
              onChange={(ev) => setValue(ev.target.value)}
              autoComplete="off"
              name={provider.settingKey}
              aria-label={`${name} key`}
            />
            <div className="sc-setup-acts">
              <button type="submit" className="sc-btn sc-btn-primary" disabled={busy || !value.trim()}>
                {busy ? <Spinner size="1" /> : <Key size={15} />}
                {connected ? 'Replace key' : 'Connect'}
              </button>
              <a className="sc-setup-alt" href={provider.keysUrl} target="_blank" rel="noreferrer">
                Get a key <ArrowSquareOut size={13} />
              </a>
            </div>
          </form>
        )}

        {thisComputer && connected && (
          <div className="sc-setup-cut">
            <Confirm
              label="Disconnect"
              title={`Disconnect ${name}?`}
              body={`The key is deleted from this computer. Nothing you have already generated changes, and you can paste a new key at any time.`}
              busy={busy}
              onConfirm={() => void disconnect()}
            />
          </div>
        )}

        {fromEnv && (
          <p className="sc-setup-note">
            The stored key is gone, but {name} is still connected through the {provider.settingKey.toUpperCase()}{' '}
            environment variable on this computer. Remove it from your shell to disconnect fully.
          </p>
        )}

        {error && (
          <div className="sc-setup-problem">
            <p data-detail="">
              <Warning size={15} /> {error}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Codex: install it, sign in, done.
 *
 * The honest branch matters as much as the happy one. Without a ChatGPT plan
 * there is nothing for Codex to draw on, and saying so plainly beats a spinner
 * that never resolves, so those users are pointed at a provider key instead.
 */
function CodexPane({ engines, onSaved, onDone }: { engines: EngineInfo[]; onSaved: () => void; onDone: () => void }) {
  const openSetup = useOpenSetup();
  const [phase, setPhase] = useState<Phase>('checking');
  const [problem, setProblem] = useState<{ detail?: string; command?: string; docsUrl?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [platform, setPlatform] = useState<SetupPlatform>('mac');
  // The probe's own sentence for a state that has more than one cause. An
  // update is needed below Scenri's floor, and also when this CLI predates the
  // model Scenri runs it on (gpt-6-sol); the wizard used to claim the first
  // for both.
  const [reason, setReason] = useState<string | null>(null);
  // Which variables are in the way, and which Scenri is already keeping out of
  // codex's environment. Names only; a value never crosses this boundary.
  const [conflictKeys, setConflictKeys] = useState<string[]>([]);
  const [ignoredKeys, setIgnoredKeys] = useState<string[]>([]);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const probe = useCallback(async (force = false) => {
    const { state, reason: why, platform: p, conflictKeys: c, ignoredKeys: ig } = await api.codexStatus({ force });
    if (p) setPlatform(p);
    setReason(why ?? null);
    setConflictKeys(c ?? []);
    setIgnoredKeys(ig ?? []);
    setPhase(state);
    return state;
  }, []);

  // Re-probe on mount: the fix may have happened outside this dialog. A
  // request that itself failed is "could not verify", never "not installed".
  useEffect(() => {
    setProblem(null);
    setPhase('checking');
    void probe().catch(() => setPhase('unverified'));
    return stopPolling;
  }, [probe, stopPolling]);

  // The one control that deliberately spends a turn of the user's plan: it
  // runs a real `codex exec` rather than repeating the last verdict, which is
  // the only way "ready" can mean anything.
  const checkAgain = useCallback(() => {
    setProblem(null);
    setPhase('checking');
    void probe(true).catch(() => setPhase('unverified'));
  }, [probe]);

  const repairEnv = async () => {
    setProblem(null);
    setPhase('repairing');
    try {
      const { state, conflictKeys: c, ignoredKeys: ig, reason: why } = await api.repairCodexEnv(conflictKeys);
      setConflictKeys(c ?? []);
      setIgnoredKeys(ig ?? []);
      setReason(why ?? null);
      setPhase(state);
    } catch (err) {
      setProblem({ detail: (err as Error).message });
      setPhase('env-conflict');
    }
  };

  const restoreEnv = async () => {
    setProblem(null);
    setPhase('checking');
    try {
      const { state, conflictKeys: c, ignoredKeys: ig } = await api.restoreCodexEnv();
      setConflictKeys(c ?? []);
      setIgnoredKeys(ig ?? []);
      setPhase(state);
    } catch {
      void probe().catch(() => setPhase('unverified'));
    }
  };

  // A ready engine is worth telling the rest of the app about, so the composer
  // banner and the engine picker catch up without a reload.
  useEffect(() => {
    if (phase === 'ready') onSaved();
  }, [phase, onSaved]);

  const install = async () => {
    setProblem(null);
    setPhase('installing');
    try {
      const res = await api.installCodex();
      // The re-probe outranks the exit code: when the binary is present anyway
      // (say a sudo install done in Terminal), the step is done and a stale
      // error would only contradict the green check beside it.
      if (res.ok || res.state !== 'not-installed') {
        setPhase(res.state);
        return;
      }
      setProblem({ detail: res.detail, command: res.fallbackCommand, docsUrl: res.docsUrl });
      setPhase(res.state);
    } catch (err) {
      setProblem({ detail: (err as Error).message, command: 'npm install -g @openai/codex' });
      setPhase('not-installed');
    }
  };

  const signIn = async () => {
    setProblem(null);
    setPhase('signing-in');
    // Poll alongside the request: the sign-in finishes in the browser, and a
    // closed tab or an abandoned flow should still land somewhere honest.
    const startedAt = Date.now();
    stopPolling();
    pollRef.current = window.setInterval(() => {
      if (Date.now() - startedAt > LOGIN_TIMEOUT_MS) {
        stopPolling();
        setPhase('not-authenticated');
        setProblem({ detail: 'Sign-in did not finish. Try again, or use the command below.', command: 'codex login' });
        return;
      }
      void api
        .codexStatus()
        .then(({ state }) => {
          if (state === 'ready') {
            stopPolling();
            setPhase('ready');
          }
        })
        .catch(() => {});
    }, LOGIN_POLL_MS);

    try {
      const res = await api.loginCodex();
      stopPolling();
      // Same rule as install: a signed-in machine needs no error, whatever
      // the login command's exit code said.
      if (res.ok || res.state === 'ready') {
        setPhase(res.state);
        return;
      }
      setProblem({ detail: res.detail, command: res.fallbackCommand });
      setPhase(res.state);
    } catch (err) {
      stopPolling();
      setProblem({ detail: (err as Error).message, command: 'codex login --device-auth' });
      setPhase('not-authenticated');
    }
  };

  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    },
    [],
  );
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
    });
  };

  /** Any engine that can carry a Product or a Presenter and is already usable. */
  const otherReady = engines.filter((e) => e.available && e.id !== 'codex-cli' && !e.localOnly);

  const busy = phase === 'checking' || phase === 'installing' || phase === 'signing-in' || phase === 'repairing';
  // The step in hand is the one row that can be pressed, and it carries the
  // phase's own action, as the step in hand does in Learn.
  const act: StepAct | null =
    phase === 'not-installed' || phase === 'installing'
      ? {
          step: 0,
          label: 'Install Codex CLI',
          verb: phase === 'installing' ? 'Installing' : 'Install',
          busy: phase === 'installing',
          run: install,
        }
      : phase === 'not-authenticated' || phase === 'signing-in'
        ? {
            step: 1,
            label: 'Sign in with ChatGPT',
            verb: phase === 'signing-in' ? 'Waiting for your browser' : 'Sign in',
            busy: phase === 'signing-in',
            run: signIn,
          }
        : phase === 'env-conflict' || phase === 'repairing'
          ? {
              step: 2,
              label: 'Ignore that key',
              verb: phase === 'repairing' ? 'Ignoring' : 'Ignore that key',
              busy: phase === 'repairing',
              run: repairEnv,
            }
          : null;
  const offerNoPlan =
    phase === 'not-installed' || phase === 'installing' || phase === 'not-authenticated' || phase === 'signing-in';

  return (
    <>
      <SetupHead title="Set up image generation" />

      <div className="sc-setup-body">
        <div className="sc-setup-intro">
          <Subject engineId="codex-cli" name="Codex CLI" state={STATE[phase]} ready={phase === 'ready'} busy={busy} />
          <p className="sc-setup-lead">{LEAD[phase](reason)}</p>
          {phase === 'no-plan' && (
            <p className="sc-setup-lead">
              You can use your own key from an image provider instead. You pay that provider directly, per image, and
              the key stays in your library folder on this computer.
            </p>
          )}
        </div>

        {phase !== 'no-plan' && <Steps phase={phase} act={act} />}

        {phase === 'signing-in' && (
          <p className="sc-setup-note">Finish in the browser tab that just opened. This screen updates itself.</p>
        )}
        {(phase === 'env-conflict' || phase === 'repairing') && (
          <p className="sc-setup-note">{repairNote(conflictKeys)}</p>
        )}
        {phase === 'ready' && ignoredKeys.length > 0 && (
          <p className="sc-setup-note">
            {repairedNote(ignoredKeys)}{' '}
            <button type="button" className="sc-setup-alt" onClick={restoreEnv}>
              Use it again
            </button>
          </p>
        )}
        {phase === 'unverified' && (
          <p className="sc-setup-note">
            If you just installed Codex, quit and reopen Scenri so it can see the new command.
          </p>
        )}
        {phase === 'update-needed' && (
          <>
            <div className="sc-setup-cmd">
              <code>npm install -g @openai/codex@latest</code>
              <button
                type="button"
                className="sc-btn sc-btn-ghost"
                onClick={() => copy('npm install -g @openai/codex@latest')}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {platform === 'windows' && (
              <p className="sc-setup-note">
                Installed with the standalone installer instead? Update it in PowerShell:{' '}
                <code>{'irm https://chatgpt.com/codex/install.ps1 | iex'}</code>
              </p>
            )}
          </>
        )}
        {phase === 'no-plan' && otherReady.length > 0 && (
          <p className="sc-setup-note">
            {otherReady.map((e) => engineTitle(e.displayName)).join(', ')} is already connected, so you can generate
            now.
          </p>
        )}

        {problem && (
          <div className="sc-setup-problem">
            <p data-detail="">
              <Warning size={15} /> {problem.detail ?? 'That did not work.'}
            </p>
            {problem.command && (
              <>
                <p className="sc-setup-note">
                  Run this in {platform === 'windows' ? 'PowerShell' : 'Terminal'}, then reopen this window:
                </p>
                <div className="sc-setup-cmd">
                  <code>{problem.command}</code>
                  <button type="button" className="sc-btn sc-btn-ghost" onClick={() => copy(problem.command as string)}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </>
            )}
            {problem.docsUrl && (
              <a className="sc-setup-alt" href={problem.docsUrl} target="_blank" rel="noreferrer">
                Installation help <ArrowSquareOut size={13} />
              </a>
            )}
          </div>
        )}

        {/* What is left to do once the steps have said where things stand: one
            primary at most, anything beside it filled, a way out as a link. */}
        {phase === 'ready' && (
          <div className="sc-setup-acts">
            <button type="button" className="sc-btn sc-btn-primary" onClick={onDone}>
              Start creating
            </button>
            <button type="button" className="sc-btn sc-btn-ghost" onClick={checkAgain}>
              <ArrowsClockwise size={14} /> Check again
            </button>
          </div>
        )}
        {(phase === 'unverified' || phase === 'update-needed') && (
          <div className="sc-setup-acts">
            <button type="button" className="sc-btn sc-btn-primary" onClick={checkAgain}>
              <ArrowsClockwise size={15} /> Check again
            </button>
            {phase === 'unverified' && (
              <button type="button" className="sc-setup-alt" onClick={() => setPhase('no-plan')}>
                I do not have ChatGPT
              </button>
            )}
          </div>
        )}
        {phase === 'no-plan' && (
          <div className="sc-setup-acts">
            <button type="button" className="sc-btn sc-btn-primary" onClick={() => openSetup('openrouter')}>
              <Key size={15} /> Add a provider key
            </button>
            <button type="button" className="sc-setup-alt" onClick={() => void probe()}>
              Back to Codex setup
            </button>
          </div>
        )}
        {offerNoPlan && (
          <div className="sc-setup-acts">
            <button type="button" className="sc-setup-alt" onClick={() => setPhase('no-plan')}>
              I do not have ChatGPT
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** Where Codex stands, in the words under its name. */
const STATE: Record<Phase, string> = {
  checking: 'Checking',
  'not-installed': 'Not installed',
  installing: 'Installing',
  'not-authenticated': 'Not signed in',
  'signing-in': 'Waiting for your browser',
  ready: 'Ready',
  'env-conflict': 'An old key is in the way',
  repairing: 'Setting that key aside',
  unverified: 'Could not verify',
  'update-needed': 'Needs an update',
  'no-plan': 'Needs a ChatGPT plan',
};

/** The one sentence that says what this state means. */
const LEAD: Record<Phase, (reason: string | null) => string> = {
  checking: () => 'Checking that Codex can actually reach OpenAI from this computer.',
  'not-installed': () =>
    'Scenri generates with Codex CLI, a small official helper from OpenAI that runs on this computer and uses your own ChatGPT plan. It needs to be installed once.',
  installing: () =>
    'Scenri generates with Codex CLI, a small official helper from OpenAI that runs on this computer and uses your own ChatGPT plan. It needs to be installed once.',
  'not-authenticated': () =>
    'Codex CLI is installed. Sign in with the ChatGPT account whose plan should cover your images. This opens your browser, and Scenri never sees your password or token.',
  'signing-in': () =>
    'Codex CLI is installed. Sign in with the ChatGPT account whose plan should cover your images. This opens your browser, and Scenri never sees your password or token.',
  ready: () => 'Codex CLI is ready. Your images run on your own ChatGPT plan, and Scenri adds nothing to the bill.',
  'env-conflict': () =>
    'Codex is signed in, but an old OpenAI API key on this computer is being used instead of your ChatGPT plan, and OpenAI turned it down.',
  repairing: () =>
    'Codex is signed in, but an old OpenAI API key on this computer is being used instead of your ChatGPT plan, and OpenAI turned it down.',
  unverified: () =>
    'Scenri could not verify Codex on this computer. Something answered too slowly or not at all, so nothing is assumed to work.',
  'update-needed': (reason) =>
    `${reason ?? 'Codex CLI on this computer is too old for Scenri.'} Update it once, then check again.`,
  'no-plan': () =>
    'Codex CLI draws on a ChatGPT plan, so without one there is nothing behind it to generate your images.',
};

/**
 * What is being connected and where it stands: the provider's own tile, its
 * name, and one line of state. The anchor of the pane, the way a lesson's
 * picture and name head a lesson in Learn.
 */
function Subject({
  engineId,
  name,
  state,
  ready,
  busy,
}: {
  engineId: string;
  name: string;
  state: string;
  ready?: boolean;
  busy?: boolean;
}) {
  const tile = engineTile(engineId);
  return (
    <div className="sc-setup-subject">
      <span
        className="sc-eng-ic"
        data-brand={tile ? '' : undefined}
        style={tile ? ({ '--sc-plate': tile.plate, '--sc-ink': tile.ink } as CSSProperties) : undefined}
      >
        <EngineMark engineId={engineId} />
      </span>
      <span className="sc-setup-say">
        <b className="sc-setup-name">{name}</b>
        <span className="sc-setup-state">
          {busy ? <Spinner size="1" /> : ready ? <span className="d" /> : null}
          {state}
        </span>
      </span>
    </div>
  );
}

type StepAct = { step: number; label: string; verb: string; busy: boolean; run: () => void };

/**
 * Three steps, because installing and signing in can both be done and
 * generation can still fail. The third is the one the 0.9.2 tester needed:
 * it only lights when a real Scenri-spawned codex authenticated.
 *
 * Learn's step rows (surfaces/learn.css), the one pattern the app has for a
 * task in steps: every step the same filled row, a taken step a green tick
 * that stands back, the step in hand the one row that can be pressed, with
 * its verb, and the rest receding until they are reached.
 */
function Steps({ phase, act }: { phase: Phase; act: StepAct | null }) {
  const { installed, signedIn, connected } = stepState(phase);
  const done = [installed, signedIn, connected];
  const names = ['Install Codex CLI', 'Sign in with ChatGPT', 'Connect to Scenri'];
  return (
    <ol className="sc-learn-steps sc-setup-steps">
      {names.map((name, i) => {
        const inHand = act?.step === i;
        const state = done[i] ? 'done' : inHand ? 'active' : 'todo';
        const mark = (
          <span className="sc-learn-n" aria-hidden="true">
            {done[i] ? <Check size={14} weight="bold" /> : i + 1}
          </span>
        );
        const waiting = inHand && act.busy;
        return (
          <li key={name} data-on={done[i] ? '' : undefined} data-now={inHand ? '' : undefined}>
            {inHand ? (
              <button
                type="button"
                className="sc-learn-step"
                data-state={state}
                aria-label={act.label}
                disabled={waiting}
                onClick={act.run}
              >
                {mark}
                <span className="sc-learn-step-name">{name}</span>
                <span className="sc-learn-go" aria-hidden="true">
                  {waiting ? <Spinner size="1" /> : null}
                  {act.verb}
                  {waiting ? null : <ArrowRight size={12} weight="bold" />}
                </span>
              </button>
            ) : (
              <div className="sc-learn-step" data-state={state}>
                {mark}
                <span className="sc-learn-step-name">{name}</span>
                {done[i] && <span className="sc-vh">, done</span>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
