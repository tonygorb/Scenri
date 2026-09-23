import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
  helpLines,
  phoneLink,
  phoneRow,
} from './phoneAccessRules.js';

/** While the code is up, how often to look for the phone. */
const POLL_MS = 2000;

/**
 * Opening Scenri on a phone, a tablet or another computer on the same Wi-Fi.
 * One row, one button: Show QR code opens the code in place, with the typed
 * address and code beside it for a device without a camera, Copy link, and a
 * line that turns to Connected the moment a device opens it. The firewall is
 * read the moment the code shows: when it would stop a phone, Allow Scenri
 * says so and fixes it through the system's own prompt, before anyone scans.
 * If no device arrives anyway, the help opens by itself.
 *
 * Read fresh every time General opens and every two seconds while the code
 * shows: the address follows whichever Wi-Fi this computer is on now.
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
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const { push } = useToasts();

  const load = useCallback(async () => {
    try {
      setStatus(await api.phone());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, [load]);

  const open = shownAt !== null && !!status?.url;
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      setNow(Date.now());
      void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [open, load]);

  const state = open && status && shownAt !== null ? arrival(status, shownAt, now) : null;
  // The help opens by itself once, when nothing has arrived; after that it is the person's.
  useEffect(() => {
    if (state === 'stuck') setHelpOpen(true);
  }, [state]);
  // Read the firewall as the code goes up, so a block is fixed before anyone scans.
  const readFirewall = open && !!status?.thisComputer;
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
  const link = status ? phoneLink(status) : null;

  const toggle = () => {
    if (open) {
      setShownAt(null);
      return;
    }
    const t = Date.now();
    setShownAt(t);
    setNow(t);
    setHelpOpen(false);
    setVerdict(null);
    setAllowing('idle');
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

  const copy = async () => {
    if (!link) return;
    if (await copyText(link, panelRef.current)) {
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } else {
      push({ kind: 'warning', title: 'Could not copy the link', detail: link });
    }
  };

  return (
    <Group title="Phone and tablet">
      <div className="sc-set-row">
        <span className="txt">
          <b>Open on your phone</b>
          <small data-prose="">{row.sentence}</small>
        </span>
        {row.action === 'show' && (
          <button
            type="button"
            className="sc-btn sc-btn-ghost"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={toggle}
          >
            {open ? 'Hide QR code' : 'Show QR code'}
          </button>
        )}
        {row.action === 'check' && (
          <button type="button" className="sc-btn sc-btn-ghost" onClick={() => void load()}>
            Check again
          </button>
        )}
      </div>
      {open && status && link && (
        <div className="sc-phone" id={panelId} ref={panelRef}>
          <QrCode value={link} label={`QR code for ${status.address}`} />
          <div className="sc-phone-how">
            <b>Scan it with your phone's camera.</b>
            {/* read off this screen and typed on another: both set apart, in type that tells 0 from O */}
            <p>
              Or type <b className="sc-phone-key">{status.address}</b> in its browser, then enter the code{' '}
              <b className="sc-phone-key">{status.code}</b>.
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
            <div className="sc-phone-act">
              <button type="button" className="sc-btn sc-btn-ghost" onClick={() => void copy()}>
                <span aria-live="polite">{copied ? 'Copied' : 'Copy link'}</span>
              </button>
            </div>
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
    </Group>
  );
}
