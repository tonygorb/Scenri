import type { VersionInfo } from '../../api.js';
import { Group } from './Group.js';

const INSTALL_LABEL: Record<VersionInfo['installKind'], string> = {
  npx: 'run with npx',
  global: 'installed with npm',
  managed: 'managed install',
  dev: 'running from source',
  unknown: 'local studio',
};

/**
 * The copy of Scenri you are running: which version and how it got here, its
 * license, and where its source lives. Keeping it current is the Updates page.
 */
export function About({ version }: { version: VersionInfo | null }) {
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
