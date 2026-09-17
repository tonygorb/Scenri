import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, GearSix, MagnifyingGlass, Plus, Power } from '@phosphor-icons/react';
import { BarMenu, BarRow } from './BarMenu.js';
import { Confirm } from '../../Confirm.js';
import { useToasts } from '../../toasts.js';
import { BrandAvatar, brandName } from '../nav.js';
import { useAppData } from '../../app/AppShell.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useUpdateCenter } from '../../app/UpdateCenter.js';
import { brandPath } from '../../routes.js';
import { useOpenSettings } from '../../app/dialogs.js';

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
 * The panel puts the brand you are in above a hairline, on its own. It answers
 * "where am I", which is a different question from "where else could I be", and
 * the list below answers that one. Past six brands a finder appears, because a
 * list stops being something you read and becomes something you search.
 *
 * What is new, the release you are running and the keyboard shortcuts used to be
 * in this menu. They answer "what is this" rather than "which brand", so they are
 * behind the help button in the page's corner.
 */
export function BrandButton() {
  const { brands } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const openSettings = useOpenSettings();
  const updates = useUpdateCenter();
  const { push } = useToasts();
  // The confirm lives beside the menu, not inside it: a menu item unmounts on
  // select, and a dialog mounted in it would go with it.
  const [quitAsk, setQuitAsk] = useState(false);
  const [find, setFind] = useState('');
  const quit = async () => {
    const refused = await updates.quit();
    if (refused) push({ kind: 'error', title: 'Scenri is still working', detail: refused });
  };
  // Display names that appear on more than one brand need their slug shown, or
  // two rows read as one brand listed twice and the click is a coin toss.
  const nameKey = (b: (typeof brands)[number]) => brandName(b).trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const b of brands) counts.set(nameKey(b), (counts.get(nameKey(b)) ?? 0) + 1);

  const searchable = brands.length >= 7;
  const others = useMemo(() => {
    const rest = brands.filter((b) => b.id !== brand.id);
    const q = find.trim().toLowerCase();
    if (!q) return rest;
    return rest.filter((b) => brandName(b).toLowerCase().includes(q) || b.slug.toLowerCase().includes(q));
  }, [brands, brand.id, find]);

  const row = (b: (typeof brands)[number], current: boolean) => {
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
        {searchable && (
          <label className="sc-menu-find">
            <MagnifyingGlass size={16} aria-hidden="true" />
            <input
              type="search"
              value={find}
              placeholder="Find a brand"
              aria-label="Find a brand"
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                // Enter takes the first match, which is what a finder is for.
                if (e.key !== 'Enter' || others.length === 0) return;
                e.preventDefault();
                navigate(brandPath(others[0]));
              }}
            />
          </label>
        )}

        {row(brand, true)}
        <div className="sc-menu-rule" />
        {others.map((b) => row(b, false))}
        {others.length === 0 && <p className="sc-menu-none">No brand by that name.</p>}

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
