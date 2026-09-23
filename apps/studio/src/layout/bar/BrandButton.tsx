import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, GearSix, MagnifyingGlass, Plus, Power } from '@phosphor-icons/react';
import { BarMenu, BarRow } from './BarMenu.js';
import { byName, findBrands } from './brandMenuRules.js';
import { Confirm } from '../../Confirm.js';
import { useToasts } from '../../toasts.js';
import { BrandAvatar, brandName } from '../nav.js';
import { useAppData } from '../../app/AppShell.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useUpdateCenter } from '../../app/UpdateCenter.js';
import { brandPath } from '../../routes.js';
import { useOpenSettings } from '../../app/dialogs.js';
import type { Brand } from '../../apiTypes.js';

/**
 * The one identity control, at the end of the bar. The mark is the brand's own
 * logo rather than a person, because there is no person: Scenri has no accounts,
 * no session and no profile, and the only identity the server knows is a machine
 * token. It carries the brand block, so switching client and reaching Settings
 * are one gesture instead of two controls at opposite ends of the row.
 *
 * The trigger is the mark alone at every width. It used to carry the name and a
 * caret, dropped below 1024px; the row says which brand you are in through the
 * mark's own colour and letter, the name is in the `aria-label` and in the panel,
 * and a circle that is a photograph of your client's logo does not read as an
 * account the way a grey avatar would.
 *
 * What is new, the release you are running and the keyboard shortcuts used to be
 * in this menu. They answer "what is this" rather than "which brand", so they
 * belong to help rather than here; What's new is also a row in Settings, Updates.
 */
export function BrandButton() {
  const { brand } = useBrand();
  const openSettings = useOpenSettings();
  const navigate = useNavigate();
  const updates = useUpdateCenter();
  const { push } = useToasts();
  // The confirm lives beside the menu, not inside it: a menu item unmounts on
  // select, and a dialog mounted in it would go with it.
  const [quitAsk, setQuitAsk] = useState(false);
  const quit = async () => {
    const refused = await updates.quit();
    if (refused) push({ kind: 'warning', title: 'Scenri is still working', detail: refused });
  };

  return (
    <>
      <BarMenu
        label="Brands"
        className="sc-menu-brand"
        trigger={
          <button type="button" className="sc-org-btn" aria-label={`${brandName(brand)}, brand and settings`}>
            <BrandAvatar brand={brand} size={32} round />
          </button>
        }
      >
        <BrandList />

        {/* Setting up is a different kind of act from switching, and the hairline
          says so: the phantom-workspace tester reached /setup by clicking what
          read as part of the brand list. One line, not one per row: the three
          under it are the things this menu does besides switching. */}
        <div className="sc-menu-rule" />
        <BarRow onSelect={() => navigate('/setup')}>
          <Plus size={16} className="sc-menu-ic" />
          <span className="sc-menu-lb">Set up a brand</span>
        </BarRow>
        <BarRow onSelect={() => openSettings()}>
          <GearSix size={16} className="sc-menu-ic" />
          <span className="sc-menu-lb">Settings</span>
        </BarRow>
        {/* The way out, last. A Scenri started from the desktop icon has no
          terminal window to close; this is how the server stops, and it is
          machine-level, so it lives here rather than in a Settings pane. */}
        <BarRow data-quit="" onSelect={() => setQuitAsk(true)}>
          <Power size={16} className="sc-menu-ic" />
          <span className="sc-menu-lb">Shut down Scenri</span>
        </BarRow>
      </BarMenu>
      <Confirm
        open={quitAsk}
        onOpenChange={setQuitAsk}
        label="Shut down Scenri"
        title="Shut down Scenri?"
        body="This stops the Scenri server on this machine. Every open tab loses the studio until you start it again, from your desktop icon or with npx scenri."
        busy={updates.busy !== 'idle'}
        onConfirm={() => void quit()}
      />
    </>
  );
}

/** Past this many brands the list is reached into rather than read. */
const LONG_LIST = 7;

/**
 * One list: the brand you are in, checked and first, then every other brand A to
 * Z. Nothing is split into sections or labelled, because the order already says
 * which is which, and nothing is listed twice.
 *
 * Past six brands a finder appears and the list scrolls in place, the same height
 * at seven brands or seven hundred, so Settings and the way out never move. A
 * query searches every brand, not only the ones on screen.
 *
 * Mounted with the menu, so it opens each time at the top with an empty finder
 * rather than wherever it was last left.
 */
function BrandList() {
  const { brands } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const [find, setFind] = useState('');

  // Display names that appear on more than one brand need their slug shown, or
  // two rows read as one brand listed twice and the click is a coin toss.
  const nameKey = (b: Brand) => brandName(b).trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const b of brands) counts.set(nameKey(b), (counts.get(nameKey(b)) ?? 0) + 1);

  const long = brands.length >= LONG_LIST;
  const query = find.trim();
  const hits = long && query ? findBrands(brands, query, brandName) : [];

  const row = (b: Brand) => {
    const current = b.id === brand.id;
    const twoLine = (counts.get(nameKey(b)) ?? 0) > 1;
    return (
      <BarRow
        key={b.id}
        data-current={current || undefined}
        data-two-line={twoLine || undefined}
        // Selecting the brand you are in changes nothing except closing the
        // menu. Anything else here, a navigate or a refetch, is how the
        // phantom-workspace bug felt possible in the first place.
        onSelect={current ? undefined : () => navigate(brandPath(b))}
      >
        <BrandAvatar brand={b} size={20} round />
        <span className="sc-menu-brand-lb">
          <span dir="auto">{brandName(b)}</span>
          {twoLine && <span className="sc-menu-brand-sub">/{b.slug}</span>}
        </span>
        {current && (
          <>
            <Check size={14} className="sc-menu-check" aria-hidden="true" />
            <span className="sc-vh">, current brand</span>
          </>
        )}
      </BarRow>
    );
  };

  const others = byName(
    brands.filter((b) => b.id !== brand.id),
    brandName,
  );
  if (!long) {
    return (
      <>
        {row(brand)}
        {others.map(row)}
      </>
    );
  }

  return (
    <>
      <label className="sc-menu-find">
        <MagnifyingGlass size={16} aria-hidden="true" />
        <input
          type="search"
          value={find}
          placeholder="Find a brand"
          aria-label="Find a brand"
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            // Enter takes the first match you are not already in, which is
            // what a finder is for.
            const first = hits.find((b) => b.id !== brand.id);
            if (e.key !== 'Enter' || !first) return;
            e.preventDefault();
            navigate(brandPath(first));
          }}
        />
      </label>

      <div className="sc-menu-brands">
        {query ? (
          hits.length > 0 ? (
            hits.map(row)
          ) : (
            <p className="sc-menu-none">No brand by that name.</p>
          )
        ) : (
          <>
            {row(brand)}
            {others.map(row)}
          </>
        )}
      </div>
    </>
  );
}
