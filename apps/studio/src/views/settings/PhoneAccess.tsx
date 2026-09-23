import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type FirewallVerdict, type PhoneStatus } from '../../api.js';
import { copyText } from '../../clipboard.js';
import { QrCode } from '../../layout/QrCode.js';
import { useToasts } from '../../toasts.js';
import { Group } from './Group.js';
import {
  type AllowState,
  allowLine,
  arrival,
  arrivalLine,
  firewallNotice,
  groupCode,
  helpLines,
  phoneLink,
  phoneRow,
} from './phoneAccessRules.js';

/** While the page is open, how often to look for the phone and the address. */
const POLL_MS = 2000;

/**
 * Settings' Local access page, its Other devices card: opening Scenri on a phone, a tablet or
 * another computer on the same Wi-Fi. Opening the page is the intent, so the
 * QR code is simply there, with one row above it whose one button is Copy
 * link. Beside the code: the address and code in mono for a device without a
 * camera, and a line that turns to Connected the moment a device opens it.
 *
 * The firewall is read as the page opens: when it would stop a phone, Allow
 * Scenri says so and fixes it through the system's own prompt, before anyone
 * scans. If no device arrives anyway, the help opens by itself.
 *
 * Read fresh on open and every two seconds after: the address follows
 * whichever Wi-Fi this computer is on now.
 */
export function PhoneAccess() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [shownAt, setShownAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [helpOpen, setHelpOpen] = useState(false);
  const [verdict, setVerdict] = useState<FirewallVerdict | null>(null);
  const [allowing, setAllowing] = useState<AllowState>('idle');
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const { push } = useToasts();

  const load = useCallback(async (fresh = false) => {
    try {
      setStatus(await api.phone(fresh));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  const [renewing, setRenewing] = useState(false);
  // A new code signs every phone out; the QR, the link and the typed code all follow it.
  const newCode = async () => {
    setRenewing(true);
    try {
      setStatus(await api.phoneNewCode());
      setShownAt(Date.now());
    } catch {
      push({ kind: 'warning', title: 'Could not make a new code' });
    } finally {
      setRenewing(false);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      setNow(Date.now());
      void load();
    }, POLL_MS);
    return () => {
      clearInterval(t);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, [load]);

  const link = status ? phoneLink(status) : null;
  // the clock for "no phone yet" starts when there is a code to scan, not when the page opened
  useEffect(() => {
    if (link && shownAt === null) setShownAt(Date.now());
  }, [link, shownAt]);

  const state = status && link && shownAt !== null ? arrival(status, shownAt, now) : null;
  // The help opens by itself once, when nothing has arrived; after that it is the person's.
  useEffect(() => {
    if (state === 'stuck') setHelpOpen(true);
  }, [state]);

  // Read the firewall as the code goes up, so a block is fixed before anyone scans.
  const readFirewall = !!link && !!status?.thisComputer;
  useEffect(() => {
    if (!readFirewall) return;
    let live = true;
    api
      .phoneHelp()
      .then((r) => live && setVerdict(r.firewall))
      .catch(() => live && setVerdict('unknown'));
    return () => {
      live = false;
    };
  }, [readFirewall]);

  const row = phoneRow(status, failed);
  const notice = status ? firewallNotice(verdict, status.platform) : null;
  const outcome = status ? allowLine(allowing, status.platform) : null;

  const copy = async () => {
    if (!link) return;
    if (await copyText(link, rowRef.current)) {
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } else {
      push({ kind: 'warning', title: 'Could not copy the link', detail: link });
    }
  };

  const allow = async () => {
    setAllowing('asking');
    try {
      const r = await api.phoneAllow();
      setVerdict(r.firewall);
      setAllowing(r.result);
    } catch {
      setAllowing('failed');
    }
  };

  return (
    <Group title="Other devices">
      <div className="sc-set-row" ref={rowRef}>
        <span className="txt">
          <b>Open on your phone</b>
          <small data-prose="">{row.sentence}</small>
        </span>
        {row.action === 'copy' && (
          <button type="button" className="sc-btn sc-btn-ghost" onClick={() => void copy()}>
            <span aria-live="polite">{copied ? 'Copied' : 'Copy link'}</span>
          </button>
        )}
        {row.action === 'check' && (
          <button type="button" className="sc-btn sc-btn-ghost" onClick={() => void load(true)}>
            Check again
          </button>
        )}
      </div>
      {status && link && (
        <div className="sc-phone">
          <QrCode value={link} label={`QR code for ${status.address}`} />
          <div className="sc-phone-how">
            {/* read off this screen and typed on another: both set apart, in type that tells 0 from O */}
            <p>
              No camera? Go to <b className="sc-phone-key">{status.address}</b> in any browser on the same Wi-Fi, then
              enter <b className="sc-phone-key">{groupCode(status.code)}</b>.
            </p>
            {status.thisComputer && notice && (
              <div className="sc-phone-fw" role="status">
                <p>{notice.text}</p>
                {notice.canAllow && (
                  <button
                    type="button"
                    className="sc-btn sc-btn-primary"
                    disabled={allowing === 'asking'}
                    onClick={() => void allow()}
                  >
                    {allowing === 'asking' ? 'Waiting for your permission…' : 'Allow Scenri'}
                  </button>
                )}
              </div>
            )}
            {status.thisComputer && outcome && (
              <p className="sc-phone-allow" data-state={allowing} aria-live="polite">
                {outcome}
              </p>
            )}
            {status.thisComputer && state && (
              <p className="sc-phone-arrival" data-state={state} aria-live="polite">
                {arrivalLine(state, status)}
              </p>
            )}
            {status.thisComputer && (
              <details
                className="sc-phone-help"
                open={helpOpen}
                onToggle={(e) => setHelpOpen((e.currentTarget as HTMLDetailsElement).open)}
              >
                <summary>Not opening?</summary>
                <ul>
                  {helpLines(verdict, status).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
      {/* The way to take back a code shown on a shared screen or a lost phone:
          only the computer running Scenri can make a new one. */}
      {status?.thisComputer && link && (
        <div className="sc-set-row">
          <span className="txt">
            <b>New code</b>
            <small data-prose="">Signs out every phone and tablet. They scan the new code to open Scenri again.</small>
          </span>
          <button type="button" className="sc-btn sc-btn-ghost" disabled={renewing} onClick={() => void newCode()}>
            {renewing ? 'Making…' : 'New code'}
          </button>
        </div>
      )}
    </Group>
  );
}
