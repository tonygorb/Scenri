import { useNavigate } from 'react-router';
import { DropdownMenu } from '@radix-ui/themes';
import { ArrowCircleUp, CaretDown, Check, GearSix, Plus, Sparkle } from '@phosphor-icons/react';
import { BrandAvatar, brandName } from './nav.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useUpdateCenter } from '../app/UpdateCenter.js';
import { useWhatsNew } from '../app/WhatsNew.js';
import { brandPath } from '../routes.js';
import { useOpenSettings } from '../app/dialogs.js';

/**
 * The one identity control, at the end of the bar. The mark is the brand's own
 * logo rather than a person, because there is no person: Scenri has no accounts,
 * no session and no profile, and the only identity the server knows is a machine
 * token. It carries the whole brand block, so switching client and reaching
 * Settings are one gesture instead of two controls at opposite ends of the row.
 *
 * The trigger names the brand, because a lone circle in this corner reads as an
 * account in an app that has none. Below 1024px the name and caret drop and the
 * mark stands alone: the phone bar was better as a mark, and it is also where
 * the set crumb needs the room. The list names every brand including the
 * current one, checked, and selecting the current one is a no-op that closes
 * the menu. It used to list only the others, which with a single brand left
 * "Set up a brand" as the only clickable row in the block — one stray click
 * from a duplicate workspace. Two brands sharing a display name show their
 * slug underneath, because the slug is the URL and the only visible difference
 * between them.
 *
 * Theme is deliberately absent. Settings already owns an Appearance pane with
 * the same three choices, and a segmented picker in here outweighed everything
 * around it for a setting nobody changes twice.
 *
 * The brand kit has no row of its own. It is the first pane in Settings and the
 * one Settings opens on, so a second door beside "Settings" was two names for
 * one place. It stays out of the top nav for the same reason the nav has five
 * items and not six: it is filled in once and revisited rarely, and a nav slot
 * has to earn itself against work you do every session.
 */
export function BrandMenu() {
  const { brands } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const openSettings = useOpenSettings();
  const updates = useUpdateCenter();
  const whatsNew = useWhatsNew();
  // Display names that appear on more than one brand need their slug shown,
  // or two rows read as one brand listed twice and the click is a coin toss.
  const nameKey = (b: (typeof brands)[number]) => brandName(b).trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const b of brands) counts.set(nameKey(b), (counts.get(nameKey(b)) ?? 0) + 1);
  // Gold reads as "notice", never as selection (active state is monochrome by
  // doctrine). One dot for two reasons — a newer Scenri, or notes not yet read
  // for this one — because two dots on one control says nothing twice. The
  // rows below say which it is.
  const updateAvailable = Boolean(updates.status?.available);
  const showDot = (updateAvailable && !updates.dismissed) || whatsNew.unread;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button type="button" className="sc-org-btn" aria-label={`${brandName(brand)}, brand and settings`}>
          <BrandAvatar brand={brand} size={22} />
          <span dir="auto" className="sc-org-name">
            {brandName(brand)}
          </span>
          <CaretDown size={11} className="sc-caret" />
          {showDot && <span className="sc-upd-dot" aria-hidden="true" />}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content align="end" sideOffset={8} className="sc-menu">
        {brands.map((b) => {
          const current = b.id === brand.id;
          const twoLine = (counts.get(nameKey(b)) ?? 0) > 1;
          return (
            <DropdownMenu.Item
              key={b.id}
              className="sc-menu-item"
              data-current={current || undefined}
              data-two-line={twoLine || undefined}
              // Selecting the brand you are in changes nothing except closing
              // the menu. Anything else here — a navigate, a refetch — is how
              // the phantom-workspace bug felt possible in the first place.
              onSelect={current ? undefined : () => navigate(brandPath(b))}
            >
              <BrandAvatar brand={b} size={20} />
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
            </DropdownMenu.Item>
          );
        })}

        {/* Setting up is a different kind of act from switching, and the
            hairline says so: the phantom-workspace tester reached /setup by
            clicking what read as part of the brand list. */}
        <div className="sc-menu-sep" />
        <DropdownMenu.Item className="sc-menu-item" onSelect={() => navigate('/setup')}>
          <Plus size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">Set up a brand</span>
        </DropdownMenu.Item>

        <div className="sc-menu-sep" />

        {updateAvailable && (
          <DropdownMenu.Item className="sc-menu-item" data-update="" onSelect={() => openSettings('about')}>
            <ArrowCircleUp size={18} className="sc-menu-ic" />
            <span className="sc-menu-lb">Update available · {updates.status?.latest}</span>
          </DropdownMenu.Item>
        )}
        {/* Permanent, and gated on nothing: the release you are running is
            always a thing you are allowed to read about. */}
        <DropdownMenu.Item className="sc-menu-item" onSelect={() => whatsNew.open()}>
          <Sparkle size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">What's new</span>
          {whatsNew.unread && (
            <>
              <span className="sc-menu-new" aria-hidden="true" />
              {/* unread must survive a monochrome display and a screen reader */}
              <span className="sc-vh">, not read yet</span>
            </>
          )}
        </DropdownMenu.Item>
        <DropdownMenu.Item className="sc-menu-item" onSelect={() => openSettings()}>
          <GearSix size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">Settings</span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
