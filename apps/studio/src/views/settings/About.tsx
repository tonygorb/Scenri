import { useEffect, useState } from 'react';
import { api, type VersionInfo } from '../../api.js';
import { useUpdateCenter } from '../../app/UpdateCenter.js';
import { useWhatsNew } from '../../app/WhatsNew.js';
import { canOneClick } from '../../app/updateRules.js';
import { Group } from './Group.js';

const INSTALL_LABEL: Record<VersionInfo['installKind'], string> = {
  npx: 'run with npx',
  global: 'installed with npm',
  managed: 'managed install',
  dev: 'running from source',
  unknown: 'local studio',
};

/** The one manual command that updates this particular install. */
function updateCommand(kind: VersionInfo['installKind'] | undefined): string {
  switch (kind) {
    case 'npx':
      return 'npx scenri update';
    case 'global':
    case 'managed':
      return 'scenri update';
    default:
      return 'npx scenri@latest';
  }
}

export function About({ version }: { version: VersionInfo | null }) {
  const updates = useUpdateCenter();
  const whatsNew = useWhatsNew();
  const s = updates.status;
  const [autoCheck, setAutoCheck] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void api
      .settings()
      .then((all) => setAutoCheck(Boolean(all.updateCheck)))
      .catch(() => {});
  }, []);

  const toggleAutoCheck = async () => {
    if (autoCheck === null) return;
    const next = !autoCheck;
    setAutoCheck(next);
    try {
      await api.saveSettings({ updateCheck: next });
    } catch {
      setAutoCheck(!next);
    }
  };

  const command = updateCommand(version?.installKind);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the command is on screen to select */
    }
  };

  const verdict = updates.checking ? (
    <span className="sc-tag">checking…</span>
  ) : s?.available ? (
    <span className="sc-tag sc-tag-gold">{s.latest} available</span>
  ) : s?.error ? (
    <span className="sc-tag">couldn't reach npm</span>
  ) : s?.checkedAt ? (
    <span className="sc-tag">up to date</span>
  ) : null;

  return (
    <Group>
      <div className="sc-set-row">
        <span className="txt">
          <b>Scenri</b>
          <small>
            {version ? `v${version.version}` : ''} · {INSTALL_LABEL[version?.installKind ?? 'unknown']}
          </small>
        </span>
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>Updates</b>
          <small data-prose="">
            {s?.available ? `You are on ${s.current}.` : 'New versions announce themselves here.'}
            {/* What is in the version you do not have yet can only come from
                the release page — the notes that ship inside a build describe
                that build. One link, no fetch, no second renderer. */}
            {s?.available && s.notesUrl && (
              <>
                {' '}
                <a href={s.notesUrl} target="_blank" rel="noreferrer">
                  See what's in {s.latest}
                </a>
              </>
            )}
          </small>
        </span>
        {verdict}
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          disabled={updates.checking}
          onClick={() => void updates.checkNow()}
        >
          Check for updates
        </button>
      </div>
      {/* Permanent, never gated on an update being available: after you
          update is exactly when you want to read what you got. One renderer,
          one dialog — this row only opens it. */}
      <div className="sc-set-row">
        <span className="txt">
          <b>What's new</b>
          <small>
            {whatsNew.entry?.title ?? `What changed in ${whatsNew.version ? `v${whatsNew.version}` : 'this version'}.`}
          </small>
        </span>
        <button type="button" className="sc-btn sc-btn-ghost" onClick={() => whatsNew.open()}>
          Show
        </button>
      </div>
      {s?.available &&
        (version?.installKind === 'dev' ? (
          <div className="sc-set-row">
            <span className="txt">
              <b>Update</b>
              <small data-prose="">
                Running from source. Pull and rebuild when you're ready. Nothing here touches your checkout.
              </small>
            </span>
          </div>
        ) : canOneClick(s) ? (
          <div className="sc-set-row">
            <span className="txt">
              <b>Update</b>
              <small data-prose="">
                {updates.applyError ??
                  (s.phase === 'ready'
                    ? `${s.stagedVersion} is downloaded and verified. Restarting finishes it.`
                    : 'Downloads next to the running version, verifies it loads, then restarts. Your library stays put.')}
              </small>
            </span>
            <button
              type="button"
              className="sc-btn sc-btn-primary"
              disabled={updates.busy !== 'idle'}
              onClick={() => void updates.apply()}
            >
              {updates.busy === 'applying' ? 'Updating…' : s.phase === 'ready' ? 'Restart now' : 'Update now'}
            </button>
          </div>
        ) : (
          <div className="sc-set-row">
            <span className="txt">
              <b>Update</b>
              <small data-prose="">
                Run <code>{command}</code> in a terminal, then start Scenri again. Your library is not part of the app
                and stays put.
              </small>
            </span>
            <button type="button" className="sc-btn sc-btn-ghost" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy command'}
            </button>
          </div>
        ))}
      <div className="sc-set-row">
        <span className="txt">
          <b>Check for updates automatically</b>
          <small data-prose="">
            One version-number request to npm, at most daily. Off means Scenri never calls anywhere by itself.
          </small>
        </span>
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          disabled={autoCheck === null}
          onClick={() => void toggleAutoCheck()}
        >
          {autoCheck === null ? '…' : autoCheck ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>License</b>
          <small>AGPL-3.0 for the app · Apache-2.0 for the .brand format</small>
        </span>
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>Open source</b>
          <small>
            Built by Tony Gorb ·{' '}
            <a href="https://github.com/tonygorb/scenri" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </small>
        </span>
      </div>
    </Group>
  );
}
