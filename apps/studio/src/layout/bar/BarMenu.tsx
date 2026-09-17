import { cloneElement, createContext, useContext, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router';
import { DropdownMenu } from '@radix-ui/themes';
import { BarSheet } from './BarSheet.js';
import { Tip } from '../Tip.js';
import { useBarPanel } from './useBarPanel.js';
import { PHONE, useMediaQuery } from '../../useMediaQuery.js';

/**
 * A list of things you can do, opened from a control in the bar.
 *
 * On a pointer it is the app's own dropdown, which brings its own Escape,
 * outside-press, focus return, roving arrows and typeahead. On a phone it is the
 * studio's bottom sheet, because the top right corner is the furthest point from
 * a thumb and a 268px card anchored there is a menu in name only.
 *
 * One component for both so the rows are written once. A row cannot be a menu
 * item inside a sheet (there is no menu to be an item of), so the shape it takes
 * is decided here and `BarRow` reads it from the context rather than every caller
 * branching on the viewport.
 */
const SheetCtx = createContext<null | (() => void)>(null);

export function BarMenu({
  label,
  className,
  side,
  tip,
  trigger,
  children,
}: {
  /** Names the sheet for a screen reader; the menu takes its name from its trigger. */
  label: string;
  className?: string;
  /** Where the menu opens on a pointer. The help button opens upward out of itself. */
  side?: 'top' | 'bottom';
  /** An icon-only trigger says its name on hover and on focus. Pointer only. */
  tip?: string;
  trigger: ReactElement;
  children: ReactNode;
}) {
  const phone = useMediaQuery(PHONE);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  useBarPanel(open, close);

  if (phone) {
    return (
      <>
        {cloneElement(trigger as ReactElement<Record<string, unknown>>, {
          onClick: () => setOpen(!open),
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'data-on': open || undefined,
        })}
        {open && (
          <BarSheet label={label} onClose={close}>
            <div className={`sc-menu sc-menu-sheet ${className ?? ''}`}>
              <SheetCtx.Provider value={close}>{children}</SheetCtx.Provider>
            </div>
          </BarSheet>
        )}
      </>
    );
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      {tip ? (
        <Tip label={tip}>
          <DropdownMenu.Trigger>{trigger}</DropdownMenu.Trigger>
        </Tip>
      ) : (
        <DropdownMenu.Trigger>{trigger}</DropdownMenu.Trigger>
      )}
      <DropdownMenu.Content align="end" side={side} sideOffset={8} className={`sc-menu ${className ?? ''}`}>
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

/**
 * One row, in whichever shape its surface takes. A row that goes somewhere is a
 * real link in both, so middle click and Cmd click keep working.
 */
export function BarRow({
  className = 'sc-menu-item',
  to,
  onSelect,
  disabled,
  children,
  ...rest
}: {
  className?: string;
  to?: string;
  onSelect?: () => void;
  disabled?: boolean;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const closeSheet = useContext(SheetCtx);

  if (closeSheet) {
    const done = () => {
      closeSheet();
      onSelect?.();
    };
    if (to) {
      return (
        <Link className={className} to={to} onClick={closeSheet} {...rest}>
          {children}
        </Link>
      );
    }
    return (
      <button type="button" className={className} onClick={done} disabled={disabled} {...rest}>
        {children}
      </button>
    );
  }

  if (to) {
    return (
      <DropdownMenu.Item asChild className={className} {...rest}>
        <Link to={to}>{children}</Link>
      </DropdownMenu.Item>
    );
  }
  return (
    <DropdownMenu.Item className={className} onSelect={onSelect} disabled={disabled} {...rest}>
      {children}
    </DropdownMenu.Item>
  );
}
