import type { CSSProperties } from 'react';
import type { EngineInfo } from '../../api.js';
import { useOpenSetup } from '../../app/dialogs.js';
import { engineMeta, engineTitle, FALLBACK_ENGINE_ID, rowAction } from '../../engines/active.js';
import { EngineMark, engineTile, keyProviderFor } from '../../engines/providers.jsx';
import { Group } from './Group.js';

/**
 * The providers pane: four rows, one state word, one action each.
 *
 * It used to be a credential form. Every provider carried a permanently open
 * password field, so a pane whose job is "what can I generate with" opened as
 * three empty inputs. Keys now live behind each row's own action, and the list
 * answers only what it is for.
 *
 * The state vocabulary shrank with it. `available` is the whole truth the
 * server has: a key exists, or Codex is installed and signed in. "Ready", "Not
 * installed", "Not signed in" and "Key rejected" were four words for that one
 * boolean, and the last of them could never render at all, because an engine
 * with a key is available by definition.
 */

/**
 * Codex first, then registration order.
 *
 * The registry leads with OpenRouter, but the server's own build engine ranks
 * Codex at zero and it is the path that needs no key, so it is the row to read
 * first.
 */
const ordered = (engines: EngineInfo[]): EngineInfo[] =>
  [...engines].sort((a, b) => Number(b.id === FALLBACK_ENGINE_ID) - Number(a.id === FALLBACK_ENGINE_ID));

export function EnginesPane({ engines }: { engines: EngineInfo[] }) {
  const openSetup = useOpenSetup();
  const usable = engines.filter((e) => e.available);
  // One primary at most in a pane, and only while there is nothing to generate
  // with at all: past that, connecting another provider is an option, not a
  // call to action.
  const nothingConnected = usable.length === 0;

  return (
    <Group sub="Where your images are generated. Connect as many as you like, then pick one in the composer.">
      {ordered(engines).map((e) => {
        const provider = keyProviderFor(e.id);
        const name = engineTitle(e.displayName);
        // Codex is the only engine that reports which setup step it is missing,
        // and the only one whose connection is not a key.
        const action = rowAction(e, Boolean(provider));
        const state = e.available ? 'Connected' : null;
        // "Could not verify" earns both its button and its own words: the
        // button alone reads as a routine setup step, and it is not.
        const showWhy = !state && e.reason && (!action || e.code === 'unverified');
        const tile = engineTile(e.id);

        return (
          <div className="sc-eng" key={e.id} data-connected={e.available ? '' : undefined}>
            <span
              className="sc-eng-ic"
              data-brand={tile ? '' : undefined}
              style={tile ? ({ '--sc-plate': tile.plate, '--sc-ink': tile.ink } as CSSProperties) : undefined}
            >
              <EngineMark engineId={e.id} />
            </span>
            <span className="sc-eng-name">
              <b>{name}</b>
              <small>{engineMeta(e)}</small>
            </span>
            {state && (
              <span className="sc-stat">
                <span className="d" />
                {state}
              </span>
            )}
            {/* An engine that is not connected can still say why, in its own
                words rather than ours. */}
            {showWhy && <span className="sc-stat sc-stat-why">{e.reason}</span>}
            {action && (
              <button
                type="button"
                className={`sc-btn ${nothingConnected && !provider ? 'sc-btn-primary' : 'sc-btn-ghost'} sc-eng-act`}
                onClick={() => openSetup(e.id)}
                aria-label={`${action} ${name}`}
              >
                {action}
              </button>
            )}
          </div>
        );
      })}
    </Group>
  );
}
