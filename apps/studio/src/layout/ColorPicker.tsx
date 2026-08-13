import { useEffect, useState } from 'react';
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
 * - `close` — `onChange` fires exactly once, when the popover closes, with the
 *   colour you settled on. Right for *creating*, where a live callback means
 *   one new swatch per frame of the drag.
 */
export function ColorPicker({
  value,
  onChange,
  label,
  presets,
  className,
  triggerStyle,
  commitMode = 'live',
  children,
}: {
  value: string;
  onChange: (hex: string) => void;
  /** `live` while dragging, or once on close. See the note above. */
  commitMode?: 'live' | 'close';
  /** Accessible name for the trigger — there is no visible label. */
  label: string;
  /** Colours already in play, offered as one-click choices. */
  presets?: string[];
  className?: string;
  triggerStyle?: React.CSSProperties;
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

  const close = (next: boolean) => {
    setOpen(next);
    if (!next && commitMode === 'close') {
      const hex = normalizeHex(draft);
      if (hex) onChange(hex);
    }
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
        >
          {children}
        </button>
      </Popover.Trigger>
      <Popover.Content className="sc-cp" align="start" sideOffset={6} width="232px">
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
              if (e.key === 'Enter') close(false);
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
                onClick={() => set(hex)}
              />
            ))}
          </div>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
