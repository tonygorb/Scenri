import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Popover } from '@radix-ui/themes';
import { Check, FrameCorners, SlidersHorizontal, Stack } from '@phosphor-icons/react';
import { FORMATS } from './BriefInput.js';
import { sizingOf, supportsFormat } from '../engines/capabilities.js';

/**
 * The stored id stays `quality` — it is a persisted pref key and a field on
 * every brief ever written, and renaming it to match a label would reset the
 * setting for everyone who has one. What the user reads is Resolution, because
 * the long edge in pixels is the only thing this changes: not the model, not
 * the effort, not the time, and not the cost.
 */
export type QualityId = 'draft' | 'standard' | 'high';

export const RESOLUTIONS: { id: QualityId; label: string; edge: number; note: string }[] = [
  { id: 'draft', label: 'Draft', edge: 768, note: 'quick checks' },
  { id: 'standard', label: 'Standard', edge: 1024, note: 'everyday shots' },
  { id: 'high', label: 'High', edge: 1536, note: 'hero and print' },
];

/**
 * How many images one brief may return. The server clamps at eight; four is as
 * many as this can offer before a choice becomes a form.
 */
export const VARIANTS = [1, 2, 3, 4];

/** What every surface calls each setting, so no two spell it differently. */
export type ShotSettingsProps = {
  mode: 'generation' | 'edit';
  /**
   * The engine that will run this brief. Two of them cannot do everything the
   * settings offer, and a control is better dimmed before the send than
   * explained after the failure.
   */
  engineId: string;
  engineName: string;
  formatId: string;
  onFormat: (id: string) => void;
  count: number;
  onCount: (n: number) => void;
  quality: QualityId;
  onQuality: (q: QualityId) => void;
};

/**
 * A rectangle at the true proportion, centred in a fixed optical column.
 *
 * The column is what makes four of them stack with their names aligned; the
 * box inside it is the actual shape, so it is read before the numbers are. An
 * icon of a crop tool would have been the same picture beside all four.
 */
function RatioGlyph({ w, h, slot, box }: { w: number; h: number; slot: number; box: number }) {
  const scale = box / Math.max(w, h);
  return (
    <span className="sc-ratio-slot" style={{ width: slot, height: slot }} aria-hidden>
      <span className="sc-ratio" style={{ width: Math.round(w * scale), height: Math.round(h * scale) }} />
    </span>
  );
}

/**
 * The mark on the option that is currently set.
 *
 * A bare check, not the filled disc the picker uses over a photograph: on a
 * small dark surface a solid white circle is the loudest thing on screen, and
 * the row is already lifted out of the list. Always rendered and hidden when
 * it is not the answer, or the value column shifts by its width on the one row
 * that has it and the list stops being a column.
 */
const Tick = () => (
  <span className="sc-setpop-tick" aria-hidden>
    <Check size={12} weight="bold" />
  </span>
);

/**
 * One choice out of a few, as a radio group rather than a menu.
 *
 * A menu is a list of things to do; each of these is a list of what a value
 * currently *is*, which is why the dropdowns these replace could not show a
 * selection without inventing one. Arrow keys move the choice itself, the way
 * a native radio group does, so what has focus is always what is set.
 */
function Choices({
  label,
  value,
  ids,
  unavailable = [],
  onChange,
  className,
  children,
}: {
  label: string;
  value: string;
  ids: string[];
  unavailable?: string[];
  onChange: (id: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const open = ids.filter((id) => !unavailable.includes(id));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : e.key === 'Home'
            ? 'first'
            : e.key === 'End'
              ? 'last'
              : null;
    if (step === null || !open.length) return;
    e.preventDefault();
    const here = open.indexOf(value);
    const next =
      step === 'first'
        ? open[0]
        : step === 'last'
          ? open[open.length - 1]
          : step === 1
            ? open[here < 0 || here === open.length - 1 ? 0 : here + 1]
            : open[here <= 0 ? open.length - 1 : here - 1];
    onChange(next);
    // every option is already in the DOM, so the move lands before the repaint
    ref.current?.querySelector<HTMLButtonElement>(`[data-id="${next}"]`)?.focus();
  };

  return (
    /* The group takes the focus when the surface opens, not the set option:
       focusing the option itself matched :focus-visible and painted the app's
       2px ring on it, so every mouse-opened picker arrived shouting. The
       arrows are handled here, so they work from the group, and the first one
       moves focus onto a real option — which is when a keyboard user should
       see a ring, and a mouse user never does. */
    <div className={className} role="radiogroup" aria-label={label} ref={ref} tabIndex={-1} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

function Choice({
  id,
  on,
  unavailable,
  label,
  onPick,
  className,
  children,
}: {
  id: string;
  on: boolean;
  unavailable?: boolean;
  label: string;
  onPick: () => void;
  className: string;
  children: ReactNode;
}) {
  return (
    /* A native radio cannot carry the shape swatch, the name and the ratio as
       one hit target, and its own dot would be a second selected-state beside
       the row's lift. */
    // biome-ignore lint/a11y/useSemanticElements: see above
    <button
      type="button"
      role="radio"
      data-id={id}
      className={className}
      aria-checked={on}
      aria-label={label}
      aria-disabled={unavailable || undefined}
      data-on={on || undefined}
      // the set option is the group's one tab stop; the arrows reach the rest
      tabIndex={on ? 0 : -1}
      onClick={() => {
        if (!unavailable) onPick();
      }}
    >
      {children}
    </button>
  );
}

/** The line under a list that says what the engine will not do with it. */
const Foot = ({ children }: { children: ReactNode }) => <p className="sc-setpop-foot">{children}</p>;

/** Which formats this engine refuses, as ids. */
const blockedFormats = (engineId: string) => FORMATS.filter((f) => !supportsFormat(engineId, f.id)).map((f) => f.id);

/**
 * The two sentences an engine's limits are worth saying, written once. Three
 * shells show these and they must not word the same fact three ways.
 */
const shapeNote = (engineName: string, blocked: string[]) =>
  blocked.length === 0
    ? undefined
    : `${engineName} cannot make ${FORMATS.filter((f) => blocked.includes(f.id))
        .map((f) => f.hint)
        .join(' or ')}.`;
/**
 * Send the opening focus to the group rather than into it.
 *
 * Radix focuses the first tabbable thing in a surface it opens, which here is
 * the option that is already set. That matched :focus-visible and painted the
 * app's 2px ring on it, so every picker opened with the mouse arrived
 * shouting. The group is the roving target instead, and the ring appears the
 * moment an arrow key moves onto a real option.
 */
const openOnGroup = (e: Event) => {
  e.preventDefault();
  const root = (e.currentTarget ?? e.target) as HTMLElement | null;
  root?.querySelector<HTMLElement>('[role="radiogroup"]')?.focus();
};
export { openOnGroup };

/**
 * The one surface all three settings open into: same fill, border, radius,
 * shadow and distance from its own trigger. Only the contents differ, because
 * a shape, a count and a size are not the same question and answering them
 * with one component is how the count ended up as a four-item dropdown.
 *
 * Opening focuses the option that is already set, so the first arrow key moves
 * from there rather than from nowhere. Picking closes: there is one choice
 * here, and staying open after it is made would be waiting for nothing.
 */
function Pop({
  aria,
  width,
  trigger,
  open,
  onOpenChange,
  children,
  onCloseAutoFocus,
}: {
  aria: string;
  width: string;
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  children: (close: () => void) => ReactNode;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const body = useRef<HTMLDivElement>(null);

  /**
   * A surface on its way out must not take a click.
   *
   * Radix keeps the content mounted until its exit animation ends, and its
   * positioning wrapper is sized to it, so for those frames both were still
   * live boxes over the composer and the next click landed on a picker that had
   * already gone. The content is handled in CSS; the wrapper is Radix's own
   * element, and the `:has()` rule that reached it was dropped without a word
   * by the CSS minifier, so it is set here where nothing can quietly discard it.
   */
  useEffect(() => {
    const wrap = body.current?.parentElement;
    if (wrap) wrap.style.pointerEvents = open ? '' : 'none';
  }, [open]);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger>
        <button type="button" className="sc-var" aria-label={aria}>
          {trigger}
        </button>
      </Popover.Trigger>
      <Popover.Content
        ref={body}
        className="sc-setpop"
        align="end"
        sideOffset={8}
        width={width}
        onOpenAutoFocus={openOnGroup}
        onCloseAutoFocus={onCloseAutoFocus}
        /* the row owns which of the three is open; a press on it is never an
           interaction "outside" as far as this surface is concerned */
        /* A press on the row is never "outside" as far as this surface is
           concerned.

           Each setting is its own Radix root, so the open one used to treat a
           press on a neighbouring trigger as an interaction outside itself and
           dismiss on the very gesture that was opening the neighbour. Two
           layers then raced over one click and the surface you asked for opened
           and shut in the same frame. Excluded here, the row alone decides
           which of the three is open, and the switch is one state change. */
        onInteractOutside={(e) => {
          if ((e.target as Element | null)?.closest('.sc-prompt-pills')) e.preventDefault();
        }}
      >
        {children(() => onOpenChange(false))}
      </Popover.Content>
    </Popover.Root>
  );
}

/**
 * The three settings, inline, each behind its own control.
 *
 * This is the form for a composer with room to spare: the desktop hub, where
 * the row is 700px wide and stating the shape, the frame count and the size
 * costs nothing anyone misses. Where the composer is narrow — a phone, a
 * tablet, or the refinement composer in the overlay's sidebar — the same three
 * settings arrive behind one control instead, and the CSS picks which shell is
 * on screen. There is no second copy of the state: every shell drives the same
 * props from the same Composer.
 */
export function ShotSettingsPills({
  mode,
  engineId,
  engineName,
  formatId,
  onFormat,
  count,
  onCount,
  quality,
  onQuality,
  onCloseAutoFocus,
}: ShotSettingsProps & { onCloseAutoFocus?: (e: Event) => void }) {
  const format = FORMATS.find((f) => f.id === formatId) ?? FORMATS[0];
  const res = RESOLUTIONS.find((r) => r.id === quality) ?? RESOLUTIONS[1];
  const blocked = blockedFormats(engineId);
  const sizing = sizingOf(engineId);
  /**
   * One open surface between the three, rather than three that each know only
   * about themselves.
   *
   * With a state each, clicking the second control while the first was open
   * meant one surface dismissing on the same gesture that opened the next, and
   * the two raced: often enough the new one never arrived and the control read
   * as needing to be pressed twice. Here the same click is one state change.
   * The guard matters — the dismissing surface reports `false` after the new
   * one has already claimed the slot, and an unguarded `null` would shut the
   * surface the user just asked for.
   */
  const [openId, setOpenId] = useState<string | null>(null);
  /* read during a close, which happens after the render that changed it */
  const openNow = useRef<string | null>(null);
  openNow.current = openId;

  /**
   * The caret goes back to the brief when a picker closes — but not when it is
   * closing because another one is opening.
   *
   * This was the second half of the open-and-instantly-close: the outgoing
   * surface pulled focus into the brief on its way out, the surface that had
   * just opened saw focus land outside itself, and dismissed. Handing over, the
   * focus is already where it belongs, so the outgoing one leaves it alone.
   */
  const closeAutoFocus = (e: Event) => {
    e.preventDefault();
    if (openNow.current === null) onCloseAutoFocus?.(e);
  };

  const pop = (id: string) => ({
    open: openId === id,
    onCloseAutoFocus: closeAutoFocus,
    /* Opening names itself; closing only ever clears itself, so a surface on
       its way out cannot shut the one that has already taken its place. */
    onOpenChange: (next: boolean) => setOpenId((prev) => (next ? id : prev === id ? null : prev)),
  });

  return (
    <div className="sc-prompt-pills">
      {/* Always offered, in both modes: a refinement cannot reshape a picture,
          but asking for a new shape runs the same setup again at that shape,
          and the composer says so before you send. */}
      <Pop
        {...pop('aspect')}
        aria={`Aspect ${format.label}, ${format.hint}`}
        width="178px"
        trigger={
          <>
            <RatioGlyph w={format.w} h={format.h} slot={15} box={13} />
            {format.label}
          </>
        }
      >
        {(close) => (
          <>
            <Choices
              label="Aspect ratio"
              className="sc-setpop-list"
              value={formatId}
              ids={FORMATS.map((f) => f.id)}
              unavailable={blocked}
              onChange={onFormat}
            >
              {FORMATS.map((f) => (
                <Choice
                  key={f.id}
                  id={f.id}
                  className="sc-setrow"
                  on={f.id === formatId}
                  unavailable={blocked.includes(f.id)}
                  label={`${f.label}, ${f.hint}`}
                  onPick={() => {
                    onFormat(f.id);
                    close();
                  }}
                >
                  <RatioGlyph w={f.w} h={f.h} slot={20} box={17} />
                  <span className="sc-setrow-n">{f.label}</span>
                  <span className="sc-setrow-v">{f.hint}</span>
                  <Tick />
                </Choice>
              ))}
            </Choices>
            {shapeNote(engineName, blocked) && <Foot>{shapeNote(engineName, blocked)}</Foot>}
          </>
        )}
      </Pop>

      {mode === 'generation' && (
        <Pop
          {...pop('variants')}
          aria={`${count} variants`}
          width="156px"
          trigger={
            <>
              <Stack size={14} />
              {count}
            </>
          }
        >
          {(close) => (
            <>
              {/* Numeric and four wide, so the whole answer fits on one line
                  and the choice is a glance rather than a read. */}
              <Choices
                label="Variants"
                className="sc-seg"
                value={String(count)}
                ids={VARIANTS.map(String)}
                onChange={(id) => onCount(Number(id))}
              >
                {VARIANTS.map((n) => (
                  <Choice
                    key={n}
                    id={String(n)}
                    className="sc-seg-o"
                    on={n === count}
                    label={`${n} variant${n === 1 ? '' : 's'}`}
                    onPick={() => {
                      onCount(n);
                      close();
                    }}
                  >
                    {n}
                  </Choice>
                ))}
              </Choices>
            </>
          )}
        </Pop>
      )}

      {/* Hidden on a refinement, which carries no size at all, and on an engine
          that reduces the request to a ratio and drops the pixels. A control
          that provably cannot affect the result is worse than absent: the
          setting moves, the number changes, and nothing else does. */}
      {mode === 'generation' && sizing !== 'ratio' && (
        <Pop
          {...pop('resolution')}
          aria={`Resolution ${res.label}, ${res.edge} px`}
          width="192px"
          trigger={
            <>
              <FrameCorners size={14} />
              {res.label}
            </>
          }
        >
          {(close) => (
            <>
              <Choices
                label="Resolution"
                className="sc-setpop-list"
                value={quality}
                ids={RESOLUTIONS.map((r) => r.id)}
                onChange={(id) => onQuality(id as QualityId)}
              >
                {RESOLUTIONS.map((r) => (
                  <Choice
                    key={r.id}
                    id={r.id}
                    className="sc-setrow"
                    on={r.id === quality}
                    label={`${r.label}, ${r.edge} px, ${r.note}`}
                    onPick={() => {
                      onQuality(r.id);
                      close();
                    }}
                  >
                    <span className="sc-setrow-n">{r.label}</span>
                    <span className="sc-setrow-v">{r.edge} px</span>
                    <Tick />
                  </Choice>
                ))}
              </Choices>
            </>
          )}
        </Pop>
      )}
    </div>
  );
}

/**
 * Aspect, variants and resolution for a phone. The row cannot hold six controls
 * at 390px, so below 768px these collapse into one chip and come back as a
 * sheet under the thumb.
 *
 * Named rows, each with every one of its answers on show. A popover per row
 * would have read tidier and cost two taps and a second floating surface for a
 * choice of four; here the whole state is legible at a glance and a change is
 * one tap. Nothing closes the sheet: the point of opening it is often to set
 * two things, and the scrim is always right there.
 *
 * The chip and the desktop controls render together and CSS picks one, so there
 * is no breakpoint in JS and no second copy of the state: both drive the same
 * prefs held by the Composer.
 */
export function ShotSettings(props: ShotSettingsProps) {
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const from = useRef<{ y: number; t: number } | null>(null);
  const moved = useRef(0);

  /**
   * The bar at the top is a real handle, not a picture of one: a sheet that
   * shows the affordance and then refuses the gesture is worse than a sheet
   * with no bar at all. Pointer events rather than touch, so a trackpad drag
   * behaves the same as a thumb.
   */
  const grab = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    from.current = { y: e.clientY, t: e.timeStamp };
    moved.current = 0;
    if (sheet.current) sheet.current.style.transition = 'none';
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const drag = (e: React.PointerEvent<HTMLElement>) => {
    if (!from.current || !sheet.current) return;
    // down only: an upward pull has nowhere to go
    moved.current = Math.max(0, e.clientY - from.current.y);
    sheet.current.style.transform = `translateY(${moved.current}px)`;
  };
  const release = (e: React.PointerEvent<HTMLElement>) => {
    const start = from.current;
    from.current = null;
    if (!start || !sheet.current) return;
    sheet.current.style.transition = '';
    // a short flick is as clear an intention as a long drag
    const speed = moved.current / Math.max(1, e.timeStamp - start.t);
    if (moved.current > 96 || speed > 0.45) {
      // the transform stays put: the exit animation outranks it in the cascade
      // and carries on from where the thumb left off
      setOpen(false);
      return;
    }
    sheet.current.style.transform = '';
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="sc-var sc-shotset" aria-label="Shot settings" title="Shot settings">
          <SlidersHorizontal size={16} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="sc-shotsheet-scrim" />
        <Dialog.Content
          ref={sheet}
          className="sc-shotsheet"
          aria-describedby={undefined}
          onOpenAutoFocus={openOnGroup}
          /* Radix would otherwise pull focus to the chip, and the next
             keystroke meant for the brief would be lost */
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div
            className="sc-shotsheet-grip"
            onPointerDown={grab}
            onPointerMove={drag}
            onPointerUp={release}
            onPointerCancel={release}
          >
            <span className="sc-shotsheet-bar" aria-hidden />
            {/* the named rows below say what this is; the heading is for the
                screen reader that cannot see them yet */}
            <Dialog.Title className="sc-vh">Shot settings</Dialog.Title>
          </div>

          <ShotSettingsFields {...props} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The settings themselves, without a container.
 *
 * Aspect, variants and resolution are configuration: they matter when you reach
 * for them and cost attention every second they sit in the row. They are the
 * same three controls wherever they appear — behind their own controls where
 * the row is wide, behind More where it is not, in a sheet under the thumb on a
 * phone — so they are written once and the shells only decide where they open.
 */
export function ShotSettingsFields({
  mode,
  engineId,
  engineName,
  formatId,
  onFormat,
  count,
  onCount,
  quality,
  onQuality,
}: ShotSettingsProps) {
  const blocked = blockedFormats(engineId);
  const sizing = sizingOf(engineId);

  return (
    <>
      {/* The shape is always a choice, in both modes, because it is the one of
          the three a refinement can still honour — not by editing the picture,
          which cannot change shape, but by running the same setup again at the
          new one. The composer says so before you send.

          It is also the one that is spatial rather than verbal, so it gets the
          full width of the surface and its answers get room to be shapes. */}
      <Field label="Aspect ratio" note={shapeNote(engineName, blocked)}>
        <Choices
          label="Aspect ratio"
          className="sc-seg"
          value={formatId}
          ids={FORMATS.map((f) => f.id)}
          unavailable={blocked}
          onChange={onFormat}
        >
          {FORMATS.map((f) => (
            <Choice
              key={f.id}
              id={f.id}
              className="sc-seg-o sc-seg-ratio"
              on={f.id === formatId}
              unavailable={blocked.includes(f.id)}
              label={`${f.label}, ${f.hint}`}
              onPick={() => onFormat(f.id)}
            >
              <RatioGlyph w={f.w} h={f.h} slot={17} box={14} />
              {f.hint}
            </Choice>
          ))}
        </Choices>
      </Field>

      {/* Frame count genuinely cannot survive an edit: the request carries no
          count, so an edit returns exactly one picture however many are asked
          for. Unlike the shape, there is nothing here to reinterpret. */}
      {mode === 'generation' && (
        /* Variants, not versions: these are the images one brief returns. A
           version is a branch off a finished shot, which is a different thing
           entirely. */
        <Field label="Variants">
          <Choices
            label="Variants"
            className="sc-seg"
            value={String(count)}
            ids={VARIANTS.map(String)}
            onChange={(id) => onCount(Number(id))}
          >
            {VARIANTS.map((n) => (
              <Choice
                key={n}
                id={String(n)}
                className="sc-seg-o"
                on={n === count}
                label={`${n} variant${n === 1 ? '' : 's'}`}
                onPick={() => onCount(n)}
              >
                {n}
              </Choice>
            ))}
          </Choices>
        </Field>
      )}

      {/* Resolution is the long edge asked of the engine, and an edit request
          carries no size at all: it is handed the picture and an instruction,
          and returns one the same shape. So this did nothing on a refinement
          either, which is worse than absent — the setting moved, the number
          changed, and the result could not have been affected. The same is true
          on an engine that keeps the ratio and drops the pixels. */}
      {mode === 'generation' && sizing !== 'ratio' && (
        <Field label="Resolution">
          <Choices
            label="Resolution"
            className="sc-seg"
            value={quality}
            ids={RESOLUTIONS.map((r) => r.id)}
            onChange={(id) => onQuality(id as QualityId)}
          >
            {RESOLUTIONS.map((r) => (
              <Choice
                key={r.id}
                id={r.id}
                className="sc-seg-o"
                on={r.id === quality}
                label={`${r.label}, ${r.edge} px, ${r.note}`}
                onPick={() => onQuality(r.id)}
              >
                {r.label}
              </Choice>
            ))}
          </Choices>
        </Field>
      )}
    </>
  );
}

/**
 * A named setting and every answer it has, under it.
 *
 * The name used to sit opposite the answers, which put three strips of
 * different widths down the right edge and left the shape — the one setting
 * that needs room to be shapes — squeezed into whatever was left. Stacked, all
 * three read at one rhythm and every answer is the same size as every other,
 * which is what a thumb wants and what a small sheet needs.
 *
 * The name is a caption, not a group label: the radio group inside carries the
 * accessible name, and every option states itself in full through its own
 * aria-label ("Square, 1:1", "2 variants", "Draft, 768 px, quick checks").
 */
function Field({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="sc-shotfield">
      <span className="sc-shotfield-lb">{label}</span>
      {children}
      {note && <p className="sc-shotfield-note">{note}</p>}
    </div>
  );
}
