import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import { DropdownMenu } from '@radix-ui/themes';
import { BarSheet } from './BarSheet.js';
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
interface Surface {
  /** Null on a pointer, where Radix closes the menu itself. */
  close: (() => void) | null;
  /**
   * Put focus back on the control that opened this, before a row does anything
   * that takes focus away.
   *
   * A row that opens a dialog unmounts with the menu that held it, so the dialog
   * records a dead element as the thing to restore to and hands focus to the
   * body on close. The trigger is still there, and it is where the keyboard was
   * a moment ago, so it is what the dialog should come back to.
   */
  focusTrigger: () => void;
}
const SurfaceCtx = createContext<Surface | null>(null);

export function BarMenu({
  label,
  className,
  offset = 22,
  trigger,
  children,
}: {
  /** Names the sheet for a screen reader; the menu takes its name from its trigger. */
  label: string;
  className?: string;
  /**
   * How far below the trigger the panel hangs. Every panel in the bar lands on
   * one line, 8px under the bar's own bottom edge, rather than each one hanging
   * from its own control at its own height: panels opening from neighbouring
   * controls in one corner should arrive in the same place. A 32px control in a
   * 60px row has 14px of air beneath it, so 22 puts the card 8 below the bar.
   */
  offset?: number;
  trigger: ReactElement;
  children: ReactNode;
}) {
  const phone = useMediaQuery(PHONE);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const close = () => setOpen(false);
  const focusTrigger = useCallback(() => triggerRef.current?.focus({ preventScroll: true }), []);
  useBarPanel(open, close);

  if (phone) {
    return (
      <>
        {cloneElement(trigger as ReactElement<Record<string, unknown>>, {
          ref: triggerRef,
          onClick: () => setOpen(!open),
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'data-on': open || undefined,
        })}
        {open && (
          <BarSheet label={label} onClose={close}>
            {/* No `sc-menu` here: that class IS the pointer card, and the sheet
              is already one. The rows, head and rules carry their own classes. */}
            <div className="sc-menu-sheet">
              <div className="sc-menu-head">{label}</div>
              <SurfaceCtx.Provider value={{ close, focusTrigger }}>{children}</SurfaceCtx.Provider>
            </div>
          </BarSheet>
        )}
      </>
    );
  }

  return (
    // Not modal, the way the activity popover never was. A modal menu holds the
    // whole page inert until it is gone, and that includes its closing animation:
    // a click on its own button in those 220ms, or on the next control in the
    // bar, landed on nothing. Non-modal, reopening is immediate and one click on
    // another control in the bar is that control's menu; an outside press still
    // closes this one on its way through.
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger>
        {cloneElement(trigger as ReactElement<Record<string, unknown>>, { ref: triggerRef })}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        align="end"
        sideOffset={offset}
        className={`sc-menu ${className ?? ''}`}
        // The row that opened a dialog unmounts with this menu, so Radix's own
        // restore would aim at nothing and the dialog would hand focus to the
        // body on close. The trigger is still here and is where the keyboard
        // came from.
        onPointerDownOutside={(e) => {
          // A press on this menu's own button is the button's business: it
          // toggles the menu itself. Left to the layer, a menu still closing
          // took that press for an outside one and shut the menu the press had
          // just reopened. Radix's popover makes the same exception for its own
          // trigger, which is why the activity panel never had this.
          if (triggerRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
        // Focus the menu let go of comes home to the trigger: the row that
        // opened a dialog unmounts with this menu, so Radix's own restore would
        // aim at nothing and the dialog would hand focus to the body on close.
        // After a click the trigger wears no ring (foundations/interaction.css).
        //
        // Only focus that fell to the body, though. Focus something else has
        // taken stays there: the menu another bar control just opened read it
        // being pulled back here as focus leaving it, and shut at once.
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const held = document.activeElement;
          if (!held || held === document.body) focusTrigger();
        }}
      >
        <div className="sc-menu-head">{label}</div>
        <SurfaceCtx.Provider value={{ close: null, focusTrigger }}>{children}</SurfaceCtx.Provider>
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
  const surface = useContext(SurfaceCtx);
  const closeSheet = surface?.close;

  /**
   * Whatever the row does, the keyboard ends up back on the control that opened
   * the menu rather than on nothing.
   *
   * The work waits for the menu to be gone. A dialog opened inside the select
   * records whatever holds focus at that moment, which is the menu about to
   * unmount; one tick later the trigger holds it, and that is what the dialog
   * comes back to when it closes.
   */
  const act = onSelect
    ? () => {
        surface?.focusTrigger();
        setTimeout(() => {
          surface?.focusTrigger();
          onSelect();
        }, 0);
      }
    : undefined;

  if (closeSheet) {
    const done = () => {
      closeSheet();
      act?.();
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
    <DropdownMenu.Item className={className} onSelect={act} disabled={disabled} {...rest}>
      {children}
    </DropdownMenu.Item>
  );
}
