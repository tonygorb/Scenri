import { useEffect, useRef, useState } from 'react';
import { api, type DesktopStatus } from '../../api.js';
import { desktopRow } from '../../app/desktopRules.js';
import { Group } from './Group.js';

/**
 * The other way to open Scenri: an icon on this computer's desktop. It sits in
 * Local access beside the phone, and only on the computer running Scenri,
 * since the icon it adds is that computer's. The status is read by the dialog
 * as it opens, so the row never flashes "Checking this machine." on a visit.
 */
export function DesktopShortcut({
  status,
  onStatus,
}: {
  status: DesktopStatus | null;
  onStatus: (s: DesktopStatus) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
  );
  const addToDesktop = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.desktopInstall();
      setAdded(true);
      if (addedTimer.current) clearTimeout(addedTimer.current);
      addedTimer.current = setTimeout(() => setAdded(false), 1600);
      onStatus(await api.desktop());
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };
  const shortcut = desktopRow(status, error);

  return (
    <Group title="This computer">
      {/* The same rule as Updates: one sentence, at most one button. An
          earlier Not now at the terminal never hides Add: it silenced the
          question, not the offer. */}
      <div className="sc-set-row">
        <span className="txt">
          <b>Desktop shortcut</b>
          <small data-prose="">{shortcut.body}</small>
        </span>
        {shortcut.action && (
          <button type="button" className="sc-btn sc-btn-ghost" disabled={busy} onClick={() => void addToDesktop()}>
            {added
              ? 'Added'
              : busy
                ? 'Adding…'
                : shortcut.action === 'add'
                  ? 'Add to desktop'
                  : shortcut.action === 'recreate'
                    ? 'Recreate'
                    : 'Try again'}
          </button>
        )}
      </div>
    </Group>
  );
}
