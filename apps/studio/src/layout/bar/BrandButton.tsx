import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, GearSix, MagnifyingGlass, Plus, Power } from '@phosphor-icons/react';
import { BarMenu, BarRow } from './BarMenu.js';
import { byName, findBrands, recentOthers } from './brandMenuRules.js';
import { Confirm } from '../../Confirm.js';
import { useToasts } from '../../toasts.js';
import { BrandAvatar, brandName } from '../nav.js';
import { useAppData } from '../../app/AppShell.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useUpdateCenter } from '../../app/UpdateCenter.js';
import { PREF, useLocalPref } from '../../prefs.js';
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
 * in this menu. They answer "what is this" rather than "which brand", so they are
 * behind the help button in the page's corner.
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
    if (refused) push({ kind: 'error', title: 'Scenri is still working', detail: refused });
  };

  return (
    <>
      <BarMenu
        label="Brands"
        trigger={
          <button type="button" className="sc-org-btn" aria-label={`${brandName(brand)}, brand and settings`}>
            <BrandAvatar brand={brand} size={32} round />
          </button>
        }
      >
        <BrandList />

        {/* Setting up is a different kind of act from switching, and the hairline
          says so: the phantom-workspace tester reached /setup by clicking what
          read as part of the brand list. */}
        <div className="sc-menu-rule" />
        <BarRow onSelect={() => navigate('/setup')}>
          <Plus size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">Set up a brand</span>
        </BarRow>

        <div className="sc-menu-rule" />
        <BarRow onSelect={() => openSettings()}>
          <GearSix size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">Settings</span>
        </BarRow>
        {/* The way out, last. A Scenri started from the desktop icon has no
          terminal window to close; this is how the server stops, and it is
          machine-level, so it lives here rather than in a Settings pane. */}
        <BarRow data-quit="" onSelect={() => setQuitAsk(true)}>
          <Power size={18} className="sc-menu-ic" />
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
 * The brand you are in, then where else you could be.
 *
 * The brand you are in sits above a hairline on its own. It answers "where am
 * I", which is a different question from "where else could I be", and what is
 * under the line answers that one.
 *
 * Up to six brands the others are simply listed, A to Z. Past that a finder
 * appears and the others share one scroller, six and a half rows tall: the four
 * this browser opened last, then every brand A to Z under an index label. The
 * panel is the same height at seven brands or seven hundred, the brands you move
 * between are where the menu opens, and Settings and the way out never move.
 * A query searches every brand, not only the ones on screen.
 *
 * Mounted with the menu, so it opens each time on the recent brands with an
 * empty finder rather than on wherever it was last left.
 */
function BrandList() {
  const { brands } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const [recent] = useLocalPref<string[]>(PREF.recentBrands, []);
  const [find, setFind] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  // Display names that appear on more than one brand need their slug shown, or
  // two rows read as one brand listed twice and the click is a coin toss.
  const nameKey = (b: Brand) => brandName(b).trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const b of brands) counts.set(nameKey(b), (counts.get(nameKey(b)) ?? 0) + 1);

  const long = brands.length >= LONG_LIST;
  const query = find.trim();
  const hits = long && query ? findBrands(brands, query, brandName) : [];

  // More brands below the fold: the list fades at its bottom edge, the brief's
  // own treatment, and reads sharp once there is nothing more to see. Where the
  // scroller's edge lands between two rows, the fade is the only sign the list
  // goes on.
  const syncMore = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 1) el.dataset.more = '';
    else delete el.dataset.more;
  }, []);
  // Re-read whenever what is listed changes, since that changes the scroller's height.
  useLayoutEffect(syncMore, [syncMore, query, brands.length]);

  // `list` names which list a row is in, because the same brand can be in two:
  // among the recent ones and in the index under them.
  const row = (b: Brand, list: string) => {
    const current = b.id === brand.id;
    const twoLine = (counts.get(nameKey(b)) ?? 0) > 1;
    return (
      <BarRow
        key={`${list}:${b.id}`}
        data-current={current || undefined}
        data-two-line={twoLine || undefined}
        // Selecting the brand you are in changes nothing except closing the
        // menu. Anything else here, a navigate or a refetch, is how the
        // phantom-workspace bug felt possible in the first place.
        onSelect={current ? undefined : () => navigate(brandPath(b))}
      >
        <BrandAvatar brand={b} size={28} round />
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

  if (!long) {
    return (
      <>
        {row(brand, 'current')}
        <div className="sc-menu-rule" />
        {byName(
          brands.filter((b) => b.id !== brand.id),
          brandName,
        ).map((b) => row(b, 'others'))}
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

      {row(brand, 'current')}
      <div className="sc-menu-rule" />

      <div ref={scroller} className="sc-menu-brands" onScroll={syncMore}>
        {query ? (
          hits.length > 0 ? (
            hits.map((b) => row(b, 'found'))
          ) : (
            <p className="sc-menu-none">No brand by that name.</p>
          )
        ) : (
          <>
            <div className="sc-menu-label">Recent</div>
            {recentOthers(brands, recent, brand.id).map((b) => row(b, 'recent'))}
            <div className="sc-menu-label">
              <span>All brands</span>
              <span>{brands.length}</span>
            </div>
            {byName(brands, brandName).map((b) => row(b, 'all'))}
          </>
        )}
      </div>
    </>
  );
}
