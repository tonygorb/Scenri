import { useEffect, useState, type ButtonHTMLAttributes } from 'react';
import { Popover } from '@radix-ui/themes';
import { HexColorPicker } from 'react-colorful';
import { normalizeHex } from '../brand/palette.js';

/**
 * The one colour picker.
 *
 * `<input type="color">` opens the operating system's picker: a modal window
 * that leaves the app, looks like nothing else in it, differs on every machine,
 * and on macOS arrives the size of a small dialog for the sake of choosing a
 * swatch. It also cannot show what a brand already uses.
 *
 * `react-colorful` is 2.8KB gzipped with no dependencies, and it draws into our
 * own popover, so a colour is chosen without leaving the surface that asked.
 *
 * Two commit modes, and picking the wrong one is a real bug rather than a
 * preference:
 *
 * - `live` (default) — `onChange` fires on every pointer move. Right for
 *   *editing* a colour that already exists, because the swatch tracks your
 *   finger. Callers that persist should debounce it.
 * - `close` — `onChange` fires once, with the colour you settled on. A drag
 *   or a typed hex that then closes is a choice. Closing on the colour the
 *   picker opened with is a cancel. Enter and a preset click confirm
 *   immediately. Right for *creating*, where a live callback means one new
 *   swatch per frame of the drag.
 */
export function ColorPicker({
  value,
  onChange,
  label,
  presets,
  className,
  triggerStyle,
  triggerProps,
  commitMode = 'live',
  align = 'start',
  children,
}: {
  value: string;
  onChange: (hex: string) => void;
  /** `live` while dragging, or once on close if the colour changed. See the note above. */
  commitMode?: 'live' | 'close';
  /** Accessible name for the trigger — there is no visible label. */
  label: string;
  /** Colours already in play, offered as one-click choices. */
  presets?: string[];
  className?: string;
  triggerStyle?: React.CSSProperties;
  /** Extra attributes on the trigger — a swatch row that *is* the picker. */
  triggerProps?: ButtonHTMLAttributes<HTMLButtonElement> & {
    'data-nav'?: number;
    'data-on'?: string;
  };
  /** The rail plus sits on the right edge; `end` keeps the popover on screen. */
  align?: 'start' | 'center' | 'end';
  children?: React.ReactNode;
}) {
  const safe = normalizeHex(value) ?? '#000000';
  const [draft, setDraft] = useState(safe);
  const [open, setOpen] = useState(false);

  // Adopt an outside change (undo, a re-scrape, a preset click) but never mid-drag.
  useEffect(() => {
    if (!open) setDraft(safe);
  }, [safe, open]);

  const set = (next: string) => {
    const hex = normalizeHex(next);
    if (!hex) return;
    setDraft(hex);
    if (commitMode === 'live') onChange(hex);
  };

  /** Confirm a colour and, in `close` mode, put the popover away. */
  const apply = (raw: string) => {
    const hex = normalizeHex(raw);
    if (!hex) return;
    setDraft(hex);
    onChange(hex);
    if (commitMode === 'close') setOpen(false);
  };

  const close = (next: boolean) => {
    setOpen(next);
    if (next || commitMode !== 'close') return;
    const hex = normalizeHex(draft);
    // The plus opens on a suggested hex. Leaving that untouched is cancel;
    // a drag or a typed value is the custom colour you meant to add.
    if (hex && hex !== safe) onChange(hex);
  };

  const uniquePresets = [...new Set((presets ?? []).map((p) => normalizeHex(p)).filter((p): p is string => !!p))];

  return (
    <Popover.Root open={open} onOpenChange={close}>
      <Popover.Trigger>
        <button
          type="button"
          className={className ?? 'sc-cp-trigger'}
          style={{ background: safe, ...triggerStyle }}
          aria-label={label}
          {...triggerProps}
        >
          {children}
        </button>
      </Popover.Trigger>
      <Popover.Content className="sc-cp" align={align} sideOffset={6} width="232px">
        <HexColorPicker color={draft} onChange={set} />
        <div className="sc-cp-foot">
          <span className="sc-cp-preview" style={{ background: draft }} aria-hidden />
          <input
            className="sc-cp-hex"
            value={draft}
            spellCheck={false}
            maxLength={7}
            aria-label="Hex value"
            onChange={(e) => {
              setDraft(e.target.value);
              const hex = normalizeHex(e.target.value);
              if (hex && commitMode === 'live') onChange(hex);
            }}
            onBlur={() => setDraft(normalizeHex(draft) ?? safe)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (commitMode === 'close') apply(draft);
              else setOpen(false);
            }}
          />
        </div>
        {uniquePresets.length > 0 && (
          <div className="sc-cp-presets">
            {uniquePresets.map((hex) => (
              <button
                type="button"
                key={hex}
                style={{ background: hex }}
                data-on={hex === draft || undefined}
                title={hex}
                aria-label={hex}
                onClick={() => (commitMode === 'close' ? apply(hex) : set(hex))}
              />
            ))}
          </div>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
