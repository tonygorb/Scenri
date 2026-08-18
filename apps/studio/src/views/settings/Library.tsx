import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Group } from './Group.js';
import { bytes } from './usageRules.js';

export function Library() {
  const [info, setInfo] = useState<{ dir: string; dbPath: string; images: number; bytes: number } | null>(null);
  useEffect(() => {
    void api
      .home()
      .then(setInfo)
      .catch(() => {});
  }, []);

  return (
    <Group sub="Plain files on this machine. Open them yourself, back them up like anything else.">
      <div className="sc-set-row">
        <span className="txt">
          <b>Library folder</b>
          <small>{info ? `${info.dir} · ${bytes(info.bytes)} across ${info.images} images` : '…'}</small>
        </span>
        <button type="button" className="sc-btn sc-btn-ghost" onClick={() => void api.reveal()}>
          Reveal
        </button>
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>Export everything</b>
          <small>One zip: brands, cast, briefs, shots. Never keys.</small>
        </span>
        <a className="sc-btn sc-btn-ghost" href="/api/export/all" download>
          Export
        </a>
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>Telemetry</b>
          <small>There is none. This row exists to say so.</small>
        </span>
        <span className="sc-tag">off, permanently</span>
      </div>
    </Group>
  );
}
