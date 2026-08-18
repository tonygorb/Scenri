import { useRef, useState } from 'react';
import { FrameCorners, Stack } from '@phosphor-icons/react';
import { FORMATS } from '../formats.js';
import { sizingOf } from '../../engines/capabilities.js';
import { Pop } from './Pop.js';
import { Choice, Choices, Foot, RatioGlyph, Tick } from './Choices.js';
import { RESOLUTIONS, VARIANTS, blockedFormats, shapeNote, type QualityId, type ShotSettingsProps } from './settings.js';

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
