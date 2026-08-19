import { useEffect, useState } from 'react';
import { Spinner } from '@radix-ui/themes';
import { ArrowClockwise } from '@phosphor-icons/react';
import { api, brandExportUrl } from '../../api.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useToasts } from '../../toasts.js';
import { Group } from './Group.js';
import { BrandNever } from './BrandNever.js';
import { BrandIdentity } from './BrandIdentity.js';
import { BrandPalette } from './BrandPalette.js';
import { saveLabel, useBrandDoc } from './useBrandDoc.js';
import { failureToast } from '../../failure.js';

/**
 * The brand kit, in Settings.
 *
 * It lives here rather than on a page of its own because of what it is: a
 * per-brand configuration filled in once and revisited rarely. A top-level
 * destination has to earn its slot against Create, Products, Presenters and
 * Scenes, and a logo plus five colours does not.
 *
 * Built out of this dialog's own grammar — `Group` / `.sc-set-row` / `.sc-in` —
 * rather than a visual language of its own. An earlier version brought its own
 * cards, rails and micro-caps headings in and read as a patch stitched onto the
 * side of Settings.
 *
 * Where the brand *acts* is a different question with a different answer: the
 * composer, where the mark can be attached, a single shot can be taken
 * off-brand, and the brief says how many instructions this kit just added.
 */
export function BrandPane() {
  const { brand } = useBrand();
  const { push } = useToasts();
  const doc = useBrandDoc();
  const [refreshing, setRefreshing] = useState(false);
  const [suggestions, setSuggestions] = useState<{ hex: string }[]>([]);

  const website: string = doc.json?.meta?.website ?? '';
  const [site, setSite] = useState(website);
  useEffect(() => setSite(website), [website]);

  const commitSite = () => {
    const raw = site.trim();
    // "acme.coffee" is what a person types and `format: uri` in the schema
    // rejects — and a rejected document stops every other section saving.
    const normalized = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw;
    setSite(normalized);
    const meta: Record<string, unknown> = { ...(doc.json?.meta ?? {}) };
    if (normalized) meta.website = normalized;
    else delete meta.website;
    doc.patch({ meta });
  };

  const refreshFromUrl = async () => {
    setRefreshing(true);
    try {
      // Send anything pending first: the merge runs against the stored row, so
      // an unsaved edit would be merged against its own older self.
      await doc.flush();
      const row = await api.refreshBrandFromUrl(brand.id);
      doc.applyRow(row);
      setSuggestions(row.suggestions?.palette ?? []);
      push({
        kind: 'success',
        title: 'Read the website again',
        detail: row.warnings?.length ? row.warnings.join(' ') : 'Your edits were kept.',
      });
    } catch (e: any) {
      push(failureToast(e, 'Could not read that website'));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <Group title="Identity" sub="The name and the mark.">
        <BrandIdentity brand={brand} doc={doc} />
      </Group>

      <Group title="Palette" sub="Favoured on a shot that asks for the kit.">
        <div className="sc-set-block">
          <BrandPalette doc={doc} suggestions={suggestions} />
        </div>
      </Group>

      <Group title="We never" sub="Held on every shot, whether the kit is asked for or not.">
        <div className="sc-set-block">
          <BrandNever doc={doc} />
        </div>
      </Group>

      <Group title="Portable" sub="The kit is a file, not a lock-in.">
        <div className="sc-set-row" data-stack="">
          <span className="txt">
            <b>Website</b>
            <small>
              Reads colours and marks from the site again. Edits are kept; new colours are offered, not applied.
            </small>
          </span>
          <div className="sc-set-controls">
            <input
              className="sc-in"
              value={site}
              type="url"
              inputMode="url"
              placeholder="acme.coffee"
              aria-label="Brand website"
              onChange={(e) => setSite(e.target.value)}
              onBlur={commitSite}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            <button
              type="button"
              className="sc-btn sc-btn-ghost"
              disabled={!website || refreshing}
              onClick={() => void refreshFromUrl()}
            >
              {refreshing ? <Spinner size="1" /> : <ArrowClockwise size={13} />} Refresh
            </button>
          </div>
        </div>
        <div className="sc-set-row">
          <span className="txt">
            <b>Export .brand</b>
            <small data-prose="">
              A zip holding brand.json and every image it references: the form any tool can read.
            </small>
          </span>
          <a className="sc-btn sc-btn-ghost" href={brandExportUrl(brand.id)} download onClick={() => void doc.flush()}>
            Export
          </a>
        </div>
        <div className="sc-set-row">
          <span className="txt">
            <b>Changes</b>
            <small data-prose="">Written as you make them. There is no save button to forget.</small>
          </span>
          <span className="sc-tag" data-state={doc.state}>
            {saveLabel(doc.state)}
          </span>
        </div>
      </Group>
    </>
  );
}
