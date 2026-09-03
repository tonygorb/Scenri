import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Dialog, Spinner } from '@radix-ui/themes';
import {
  ArrowsClockwise,
  ArrowSquareOut,
  Check,
  Copy,
  DownloadSimple,
  Key,
  SignIn,
  Warning,
  X,
} from '@phosphor-icons/react';
import { api, type CodexSetupState, type EngineInfo, type SetupPlatform } from '../api.js';
import { useDialogParam } from '../app/AppShell.js';
import { focusSelfOnOpen, useOpenSetup } from '../app/dialogs.js';
import { engineTitle } from '../engines/active.js';
import { EngineMark, engineTile, keyProviderFor, type KeyProvider } from '../engines/providers.jsx';
import { Confirm } from '../Confirm.js';

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

type Phase = 'checking' | CodexSetupState | 'installing' | 'signing-in' | 'no-plan';

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

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Content
        className="sc-setup"
        maxWidth="520px"
        aria-describedby={undefined}
        onOpenAutoFocus={focusSelfOnOpen}
      >
        {provider ? (
          <KeyPane
            provider={provider}
            name={engine ? engineTitle(engine.displayName) : provider.engineId}
            connected={Boolean(engine?.available)}
            onSaved={onSaved}
            onDone={close}
          />
        ) : (
          <CodexPane engines={engines} onSaved={onSaved} onDone={close} />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * The dialog's own title bar. No mark up here: beside our own heading a
 * provider's logo reads as a badge of approval from them, so it sits downstairs
 * with the sentence that names it instead.
 */
function SetupHead({ title }: { title: string }) {
  return (
    <div className="sc-setup-head">
      <Dialog.Title className="sc-setup-title">{title}</Dialog.Title>
      <span className="sc-set-sp" />
      <Dialog.Close>
        <button type="button" className="sc-set-close" aria-label="Close">
          <X size={16} />
        </button>
      </Dialog.Close>
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
  onSaved,
  onDone,
}: {
  provider: KeyProvider;
  name: string;
  connected: boolean;
  onSaved: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromEnv, setFromEnv] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  // The field is the entire dialog, so it takes focus even though the shell
  // deliberately refuses to auto-focus anything else.
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

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
        <div className="sc-setup-who">
          <span
            className="sc-eng-ic"
            data-brand=""
            style={
              {
                '--sc-plate': engineTile(provider.engineId)?.plate,
                '--sc-ink': engineTile(provider.engineId)?.ink,
              } as CSSProperties
            }
          >
            <EngineMark engineId={provider.engineId} />
          </span>
          <p className="sc-setup-lead">
            {connected
              ? `A key is saved for ${name}. Paste a new one to replace it, or disconnect to remove it from this computer.`
              : `Paste a key from ${name}. It is stored in your library folder on this computer, sent only to ${name}, and never shown again.`}
          </p>
        </div>

        <form
          className="sc-setup-key"
          onSubmit={(ev) => {
            ev.preventDefault();
            void save();
          }}
        >
          <input
            ref={fieldRef}
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

        {connected && (
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
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const probe = useCallback(async () => {
    const { state, platform: p } = await api.codexStatus();
    if (p) setPlatform(p);
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

  const checkAgain = useCallback(() => {
    setProblem(null);
    setPhase('checking');
    void probe().catch(() => setPhase('unverified'));
  }, [probe]);

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

  return (
    <>
      <SetupHead title="Set up image generation" />
      <Steps phase={phase} />

      <div className="sc-setup-body">
        {phase === 'checking' && (
          <p className="sc-setup-lead">
            <Spinner size="1" /> Checking this computer.
          </p>
        )}

        {(phase === 'not-installed' || phase === 'installing') && (
          <>
            <p className="sc-setup-lead">
              Scenri generates with Codex CLI, a small official helper from OpenAI that runs on this computer and uses
              your own ChatGPT plan. It needs to be installed once.
            </p>
            {/* The action and the way past it are one decision, so they sit on one
                line while there is room and stack when there is not. */}
            <div className="sc-setup-acts">
              <button
                type="button"
                className="sc-btn sc-btn-primary"
                onClick={install}
                disabled={phase === 'installing'}
              >
                {phase === 'installing' ? <Spinner size="1" /> : <DownloadSimple size={15} />}
                {phase === 'installing' ? 'Installing' : 'Install Codex CLI'}
              </button>
              <button type="button" className="sc-setup-alt" onClick={() => setPhase('no-plan')}>
                I do not have ChatGPT
              </button>
            </div>
          </>
        )}

        {(phase === 'not-authenticated' || phase === 'signing-in') && (
          <>
            <p className="sc-setup-lead">
              Codex CLI is installed. Sign in with the ChatGPT account whose plan should cover your images. This opens
              your browser, and Scenri never sees your password or token.
            </p>
            <div className="sc-setup-acts">
              <button
                type="button"
                className="sc-btn sc-btn-primary"
                onClick={signIn}
                disabled={phase === 'signing-in'}
              >
                {phase === 'signing-in' ? <Spinner size="1" /> : <SignIn size={15} />}
                {phase === 'signing-in' ? 'Waiting for your browser' : 'Sign in with ChatGPT'}
              </button>
              <button type="button" className="sc-setup-alt" onClick={() => setPhase('no-plan')}>
                I do not have ChatGPT
              </button>
            </div>
            {phase === 'signing-in' && (
              <p className="sc-setup-note">Finish in the browser tab that just opened. This screen updates itself.</p>
            )}
          </>
        )}

        {phase === 'ready' && (
          <>
            <p className="sc-setup-lead">
              <Check size={15} /> Codex CLI is ready. Your images run on your own ChatGPT plan, and Scenri adds nothing
              to the bill.
            </p>
            <div className="sc-setup-acts">
              <button type="button" className="sc-btn sc-btn-primary" onClick={onDone}>
                Start creating
              </button>
              <button type="button" className="sc-btn sc-btn-ghost" onClick={checkAgain}>
                <ArrowsClockwise size={14} /> Check again
              </button>
            </div>
          </>
        )}

        {phase === 'unverified' && (
          <>
            <p className="sc-setup-lead">
              Scenri could not verify Codex on this computer. Something answered too slowly or not at all, so nothing is
              assumed to work.
            </p>
            <div className="sc-setup-acts">
              <button type="button" className="sc-btn sc-btn-primary" onClick={checkAgain}>
                <ArrowsClockwise size={15} /> Check again
              </button>
              <button type="button" className="sc-setup-alt" onClick={() => setPhase('no-plan')}>
                I do not have ChatGPT
              </button>
            </div>
            <p className="sc-setup-note">
              If you just installed Codex, quit and reopen Scenri so it can see the new command.
            </p>
          </>
        )}

        {phase === 'update-needed' && (
          <>
            <p className="sc-setup-lead">
              Codex CLI on this computer is too old for Scenri. Update it once, then check again.
            </p>
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
            <div className="sc-setup-acts">
              <button type="button" className="sc-btn sc-btn-primary" onClick={checkAgain}>
                <ArrowsClockwise size={15} /> Check again
              </button>
            </div>
          </>
        )}

        {phase === 'no-plan' && (
          <>
            <p className="sc-setup-lead">
              Codex CLI draws on a ChatGPT plan, so without one there is nothing behind it to generate your images.
            </p>
            <p className="sc-setup-lead">
              You can use your own key from an image provider instead. You pay that provider directly, per image, and
              the key stays in your library folder on this computer.
            </p>
            <div className="sc-setup-acts">
              <button type="button" className="sc-btn sc-btn-primary" onClick={() => openSetup('openrouter')}>
                <Key size={15} /> Add a provider key
              </button>
              <button type="button" className="sc-setup-alt" onClick={() => void probe()}>
                Back to Codex setup
              </button>
            </div>
            {otherReady.length > 0 && (
              <p className="sc-setup-note">
                {otherReady.map((e) => engineTitle(e.displayName)).join(', ')} is already connected, so you can generate
                now.
              </p>
            )}
          </>
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
      </div>
    </>
  );
}

/** Two dots, because there are exactly two things to do and people count them. */
function Steps({ phase }: { phase: Phase }) {
  if (phase === 'no-plan') return null;
  // Update-needed means a codex IS installed, just an old one; unverified
  // claims nothing, so neither dot lights.
  const installed =
    phase === 'not-authenticated' || phase === 'signing-in' || phase === 'update-needed' || phase === 'ready';
  const signedIn = phase === 'ready';
  return (
    <ol className="sc-setup-steps">
      <li
        data-on={installed ? '' : undefined}
        data-now={phase === 'not-installed' || phase === 'installing' ? '' : undefined}
      >
        {installed ? <Check size={12} /> : <span className="d" />} Install
      </li>
      <li
        data-on={signedIn ? '' : undefined}
        data-now={phase === 'not-authenticated' || phase === 'signing-in' ? '' : undefined}
      >
        {signedIn ? <Check size={12} /> : <span className="d" />} Sign in
      </li>
    </ol>
  );
}
