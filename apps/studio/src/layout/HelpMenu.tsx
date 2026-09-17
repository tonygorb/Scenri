import { GithubLogo, Info, Keyboard, Lightning, ListChecks, Megaphone, Question } from '@phosphor-icons/react';
import { DropdownMenu } from '@radix-ui/themes';
import { useMatch, useNavigate } from 'react-router';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useOpenSettings, useOpenSetup } from '../app/dialogs.js';
import { useWhatsNew } from '../app/WhatsNew.js';
import { askForFirstSteps } from '../guide.js';
import { brandPath, P } from '../routes.js';
import { useMediaQuery } from '../useMediaQuery.js';
import { Tip } from './Tip.js';

const WIDE = '(min-width: 1024px)';
const GITHUB = 'https://github.com/tonygorb/scenri';

/**
 * Help, in one place (DESIGN.md, "First use"): First steps, for anyone who
 * wants the guided tasks back, and the help the app already has, gathered. From 1024px it floats in the
 * bottom-right corner, clear of the assets rail; below that the corner belongs
 * to the composer and the tab bar, so it sits in the top bar beside the bell.
 */
export function HelpMenu({ placement }: { placement: 'float' | 'bar' }) {
  const { brand } = useBrand();
  const navigate = useNavigate();
  const hub = useMatch(P.hub);
  const set = useMatch(P.set);
  const onCreate = !!hub || !!set;
  const whatsNew = useWhatsNew();
  const openSettings = useOpenSettings();
  const openSetup = useOpenSetup();
  const { engines } = useAppData();
  const noEngine = !engines.some((e) => e.available);

  const menu = (
    <DropdownMenu.Root>
      <Tip label="Help">
        <DropdownMenu.Trigger>
          <button type="button" className="sc-icon-btn sc-help-btn" aria-label="Help">
            <Question size={16} />
          </button>
        </DropdownMenu.Trigger>
      </Tip>
      <DropdownMenu.Content
        align="end"
        side={placement === 'float' ? 'top' : 'bottom'}
        sideOffset={8}
        className="sc-menu sc-help-menu"
      >
        <DropdownMenu.Item
          className="sc-menu-item"
          onSelect={() => {
            void askForFirstSteps();
            navigate(brandPath(brand));
          }}
        >
          <ListChecks size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">First steps</span>
        </DropdownMenu.Item>
        {onCreate && (
          <DropdownMenu.Item
            className="sc-menu-item"
            onSelect={() => window.dispatchEvent(new Event('scenri:shortcuts'))}
          >
            <Keyboard size={18} className="sc-menu-ic" />
            <span className="sc-menu-lb">Keyboard shortcuts</span>
          </DropdownMenu.Item>
        )}
        <DropdownMenu.Item className="sc-menu-item" onSelect={() => whatsNew.open()}>
          <Megaphone size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">What's new</span>
          {whatsNew.unread && (
            <>
              <span className="sc-menu-new" aria-hidden="true" />
              <span className="sc-vh">, not read yet</span>
            </>
          )}
        </DropdownMenu.Item>
        {noEngine && (
          <DropdownMenu.Item className="sc-menu-item" onSelect={() => openSetup()}>
            <Lightning size={18} className="sc-menu-ic" />
            <span className="sc-menu-lb">Set up image generation</span>
          </DropdownMenu.Item>
        )}
        <div className="sc-menu-sep" />
        <DropdownMenu.Item className="sc-menu-item" onSelect={() => openSettings('about')}>
          <Info size={18} className="sc-menu-ic" />
          <span className="sc-menu-lb">About Scenri</span>
        </DropdownMenu.Item>
        <DropdownMenu.Item className="sc-menu-item" asChild>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">
            <GithubLogo size={18} className="sc-menu-ic" />
            <span className="sc-menu-lb">Scenri on GitHub</span>
          </a>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );

  return placement === 'float' ? <div className="sc-help-float">{menu}</div> : menu;
}

/** The corner button, from 1024px. */
export function HelpFloat() {
  return useMediaQuery(WIDE) ? <HelpMenu placement="float" /> : null;
}

/** The top bar button, below 1024px. */
export function HelpBar() {
  return useMediaQuery(WIDE) ? null : <HelpMenu placement="bar" />;
}
