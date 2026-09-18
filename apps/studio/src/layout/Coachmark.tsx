import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { X } from '@phosphor-icons/react';
import {
  arrow,
  autoUpdate,
  computePosition,
  flip,
  offset,
  type Placement,
  shift,
  type VirtualElement,
} from '@floating-ui/dom';
import { caretToEnd as lineCaretToEnd } from '../composer/line.js';
import type { Side } from '../guidedTasks.js';
import { Tip } from './Tip.js';
import { createLock, type CoachLock } from './coachLock.js';
import {
  boxOf,
  height,
  intersects,
  opposite,
  pad,
  panels,
  referenceRect,
  trimBy,
  union,
  visibleRect,
  width,
  windowsMask,
  windowsRim,
  type Box,
  type Window,
} from './coachGeometry.js';

/** A window is the stage's own edge: its real corners, no halo of air around it. */
const SURFACE_PAD = 0;
/** A surface with no corners of its own (a block of text) gets room and a rounded window. */
const BLOCK_PAD = 10;
const BLOCK_RADIUS = 14;
/** The ring around the control the step asks for, clear of its edge. */
const RING_OFFSET = 4;
/** Marks a window's element while the coach holds it, so what waits inside it can recede (settings.css). */
const STAGE = 'data-guide-stage';
/**
 * The window's edge on the curtain. Barely there: a lit surface should read as
 * the page going quiet around it, never as a panel cut out and floating.
 */
const RIM = 'rgba(255,255,255,0.05)';
/** What inside a live surface is drawn as its own window, with its own radius. */
const SHAPE = '[data-guide-shape]';
/** No surfaces, shared: a new array each render would restart every effect. */
const EMPTY: readonly HTMLElement[] = [];
/** Surfaces a live control opens, which belong to the moment that opened them. */
const POPPERS = '[data-radix-popper-content-wrapper], .sc-setpop, .sc-morepop, .sc-shotsheet, .sc-note-pop';
/** Where words go: an ask for them hands over the caret rather than the card. */
const WRITABLE = 'input, textarea, [contenteditable]:not([contenteditable="false"])';
/** From the target to the card's edge: the window's air, then room for the pointer. */
const GAP = 17;
const EDGE = 12;
/** The pointer keeps clear of the card's rounded corners. */
const ARROW_INSET = 20;
const SCROLL_WAIT_MS = 450;
/** Under this there is one column of room, so nothing stands beside anything. */
const NARROW = 768;
/** Two measurements this far apart agreeing means the surface has arrived. */
const STEADY_MS = 90;
/** A page that never settles still gets its card, after this many looks. */
const STEADY_TRIES = 8;
/** How long, at most, a card waits for the surface it belongs to to finish arriving. */
const ARRIVE_TRIES = 12;
/** How long after showing a card keeps checking that what it points at has not moved. */
const WATCH_MS = 2000;
/** Fixed and sticky chrome a window must not reach under. */
const CHROME =
  '.sc-topbar, .sc-tabbar, .sc-filterbar, .sc-canvas-dock, .sc-help-float, .sc-pstudio-head, .sc-newdlg-head';
/** The card fades out before it moves; it never slides across the page. Matches --sc-dur-fast. */
const FADE_MS = 120;
/**
 * What stays live while the coach holds the page, beside the card and the
 * step's own surfaces: every announcement, the toasts that report what just
 * happened, the update float that may need an answer, and the poppers a live
 * surface opens (a chip's peek, the swap sheet, a menu).
 */
const KEEP =
  '[aria-live], .sc-toasts, .sc-upd-float, .sc-upd-overlay, [data-radix-popper-content-wrapper], .sc-chip-preview, .sc-swap, .sc-shotsheet, .sc-shotsheet-scrim, .sc-cmd';

type Phase = 'moving' | 'shown' | 'stowed' | 'away';

/** What the card says, held while it fades so the words change only once it is out of sight. */
interface View {
  id: string;
  title?: string;
  body?: string;
  canBack: boolean;
  action: CoachmarkProps['action'];
  count?: string;
}
const viewOf = (p: CoachmarkProps): View => ({
  id: p.id,
  title: p.title,
  body: p.body,
  canBack: p.canBack,
  action: p.action,
  count: p.at && p.of ? `${p.at} of ${p.of}` : undefined,
});

export interface CoachmarkProps {
  /** The moment on screen. A new id is a new moment. */
  id: string;
  /**
   * `ask` holds the page: a curtain over everything but the surface the asked
   * control sits in, which stays sharp, with only that control usable. `note`
   * only points: no curtain, no hold, and focus stays where the person put it.
   */
  voice: 'ask' | 'note';
  /** What the card points at and rings. */
  target: HTMLElement | null;
  /** What can be used while the page is held. The lit surfaces are worked out from these. */
  live: readonly HTMLElement[];
  /** Usable and lit too, but not what the step asks for: the card neither waits for them nor hands them the caret. */
  also?: readonly HTMLElement[];
  /** Kept out of the dim, but not made usable. */
  lit?: readonly HTMLElement[];
  side: Side;
  title?: string;
  body?: string;
  canBack: boolean;
  /** The card's one button, when it has one: Done, or the way out of a review. */
  action: { label: string } | null;
  /** Where this moment sits in a walk that has a length. */
  at?: number;
  of?: number;
  /** Beside its target the card is narrower, so it fits beside a picker, a dialog or a question on more screens. */
  beside?: boolean;
  /** The curtain dims and never blurs: the page behind is part of what the moment says. */
  soft?: boolean;
  /**
   * The surface that owns the screen: the page's body, or a shell that traps
   * focus over it (the presenter studio, a creation dialog, the open shot). The
   * coach is drawn inside it, so its card can be reached, and holds only it.
   */
  container: HTMLElement;
  closeLabel: string;
  onBack: (id: string) => void;
  onAction: (id: string) => void;
  onClose: (id: string) => void;
  /** ask: Escape means the same as the X. */
  onEscape: (id: string) => void;
  /** The moment is on screen. `focusMoved` is true when the card took focus, which announces it already. Keep it stable. */
  onShown: (id: string, focusMoved: boolean) => void;
  /**
   * What it was drawn on has left the page (a feed tile redrawn when its
   * picture lands). The host looks the moment up again, so the same card comes
   * back on the new element rather than staying away. Keep it stable.
   */
  onLost: () => void;
}

/**
 * The guide's one drawn surface (DESIGN.md, "First use").
 *
 * As a coach it is a window in a curtain: the page behind goes dark and soft
 * and holds still (inert, so it takes no press, no Tab and no reader cursor),
 * and the step's own surfaces show through sharp and fully working, because
 * they are the real controls and not a picture of them. The card sits beside
 * its target, centred on it and pointing at it, and never covers it.
 *
 * As a card it is the same card with none of the hold: a word beside
 * something that just happened, while the page stays the person's.
 *
 * It owns no product logic: GuideHost decides which step is showing; this
 * draws it where the control actually is and holds the page while it does.
 */
export function Coachmark(p: CoachmarkProps) {
  const { id, voice, target, live, side, container, onShown } = p;
  const lit = p.lit ?? EMPTY;
  const also = p.also ?? EMPTY;
  const coach = voice === 'ask';
  // Nothing to point at: the card sits in the middle and the whole page goes
  // quiet behind it. The one moment that does this is the opening.
  const centred = !target;
  const hasCard = !!(p.title || p.body);
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const catchRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const rimRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const pressed = useRef<'back' | 'action' | null>(null);
  const lock = useRef<CoachLock | null>(null);
  const [phase, setPhase] = useState<Phase>('moving');
  const [masked] = useState(maskSupported);
  const [view, setView] = useState<View>(() => viewOf(p));
  const latest = useRef(p);
  latest.current = p;
  const everShown = useRef(false);
  /** The step the card last showed: a live surface opening under the same step never fades the words. */
  const shownId = useRef<string | null>(null);
  /** The elements drawn as windows right now, marked as the stage. */
  const staged = useRef<HTMLElement[]>([]);
  const v = phase === 'shown' && view.id === id ? viewOf(p) : view;
  // Live elements arrive as a fresh array each render; the effects follow what is in it.
  const liveKey = useSurfaceKey(live);
  const alsoKey = useSurfaceKey(also);
  const litKey = useSurfaceKey(lit);

  // One lock for the life of the coach on screen, released however it ends.
  useEffect(() => {
    if (!coach) return;
    lock.current = createLock(container);
    return () => {
      lock.current?.release();
      lock.current = null;
      for (const el of staged.current) el.removeAttribute(STAGE);
      staged.current = [];
    };
  }, [coach, container]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const pointer = arrowRef.current;
    const veil = veilRef.current;
    const catcher = catchRef.current;
    const ring = ringRef.current;
    const rim = rimRef.current;
    if (coach && (!veil || !catcher || !ring || !rim)) return;
    if (hasCard && (!card || !pointer)) return;
    let alive = true;
    let token = 0;
    let frame = 0;
    let shown = false;
    let held = false;
    /**
     * A surface that is still arriving (a question typing itself in, a dialog
     * opening) is measured twice before the card is shown, so it is placed
     * where the surface ends up rather than where it started. It gives up
     * after a few tries, because a page that never settles still needs its
     * card.
     */
    let steadyKey = '';
    let steady = 0;
    let waited = 0;
    // Where the card went the first time: it stays on that side while it fits,
    // so a surface still settling never swings it from one side to the other.
    let last: Placement | null = null;
    let stopAuto: (() => void) | null = null;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lead = live[0] ?? target ?? container;
    let painted = '';
    const pane = target ? scrollPane(target) : null;
    setPhase('moving');

    const hold = () =>
      lock.current?.set([
        ...(card ? [card] : []),
        ...(veil ? [veil] : []),
        ...(catcher ? [catcher] : []),
        ...(ring ? [ring] : []),
        ...(rim ? [rim] : []),
        ...live,
        ...also,
        // A region kept for what it announces is kept whole only when the step
        // is not inside it: the studio's transcript is itself a live log, and
        // keeping it whole left every earlier answer's pencil within reach.
        ...[...document.querySelectorAll(KEEP)].filter((k) => ![...live, ...also].some((s) => k.contains(s))),
      ]);

    // What it points at moved out of every pane (momentum, a resize): nothing
    // is left to point at, so the page is let go until it comes back.
    const away = () => {
      lock.current?.release();
      held = false;
      setPhase('away');
    };

    // A new moment's controls are its own from the instant it begins; only the
    // card waits to fade and place. The hold left from the moment before kept
    // the brief inert for those ~200ms, so the first keys typed as the words
    // were asked for went to the page instead ("at dusk" arrived as " dusk").
    if (coach && lock.current && everShown.current) {
      hold();
      held = true;
      const field = live.find((el) => el.matches(WRITABLE));
      const now = document.activeElement;
      if (field && !live.some((s) => s.contains(now))) caretToEnd(field);
    }

    const update = async () => {
      const my = ++token;
      if ((target && !target.isConnected) || live.some((el) => !el.isConnected)) {
        away();
        // the page redrew what this was on: ask for it again
        return latest.current.onLost();
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const vv = window.visualViewport;
      const screen: Box[] = [
        { left: 0, top: 0, right: vw, bottom: vh },
        ...(vv
          ? [
              {
                left: vv.offsetLeft,
                top: vv.offsetTop,
                right: vv.offsetLeft + vv.width,
                bottom: vv.offsetTop + vv.height,
              },
            ]
          : []),
      ];
      // Each surface is cut to the pane it scrolls in, not the target's: the
      // portrait beside a question is not inside the transcript that scrolls it.
      const clipsOf = (el: HTMLElement): Box[] => {
        const own = el === target ? pane : scrollPane(el);
        return own ? [...screen, boxOf(own.getBoundingClientRect())] : screen;
      };
      const chrome = occluders(lead, container);
      // Only a bar across the screen cuts a window short; a small float over a corner does not.
      const bars = chrome.filter((c) => width(c) > vw / 3);
      const seen = target ? visibleRect(boxOf(target.getBoundingClientRect()), clipsOf(target)) : null;
      const t = seen && trimBy(seen, bars);
      if (target && !t) return away();
      // The lit surface is the shape the asked control sits in (the composer
      // card, the picker, a question), so a control is never cut out of the
      // page on its own; a control with no shape around it is its own window.
      // A popover or sheet that control opened joins them while it is open.
      const windows: Window[] = [];
      const shapes: HTMLElement[] = [];
      for (const el of [...(target ? [target] : []), ...live, ...also, ...lit, ...openPoppers()]) {
        const stage = el.closest<HTMLElement>(SHAPE) ?? el;
        if (!shapes.includes(stage)) shapes.push(stage);
      }
      // What the card is about, and so what it stands clear of: not what is
      // merely usable beside it (the portrait beside a question is lit, but the
      // card still stands against the question).
      const about = new Set(
        [...(target ? [target] : []), ...live, ...lit, ...openPoppers()].map(
          (el) => el.closest<HTMLElement>(SHAPE) ?? el,
        ),
      );
      let r: Box | null = null;
      for (const el of shapes) {
        const b = visibleRect(boxOf(el.getBoundingClientRect()), clipsOf(el));
        const trimmed = b && trimBy(b, bars);
        if (!trimmed) continue;
        const corner = cornerRadius(el);
        // A picture is cut at its own edge like a surface: padding it as a block
        // of text framed it in white, a panel floating over the page.
        windows.push(
          corner >= 4 || el.matches('img, video, canvas')
            ? { ...pad(trimmed, SURFACE_PAD), radius: corner + SURFACE_PAD }
            : { ...pad(trimmed, BLOCK_PAD), radius: BLOCK_RADIUS },
        );
        if (about.has(el)) r = r ? union(r, trimmed) : trimmed;
      }
      if (!centred && !t && !r) return away();
      // Held once per showing, and again whenever the page has redrawn a
      // surface somewhere the hold does not reach (a bar swapped at a breakpoint).
      if (held && (live.some((s) => s.closest('[inert]')) || card?.closest('[inert]'))) held = false;

      if (coach && veil && catcher && ring && rim) {
        if (!windows.length && t)
          windows.push({ ...pad(t, RING_OFFSET), radius: cornerRadius(target as HTMLElement) + RING_OFFSET });
        // The stage stays in view whole; inside it, what the step does not ask for recedes.
        for (const el of staged.current) if (!shapes.includes(el)) el.removeAttribute(STAGE);
        for (const el of shapes) el.setAttribute(STAGE, '');
        staged.current = shapes;
        const boxes = windows.map((w) => [w.left, w.top, w.right, w.bottom, w.radius].map(Math.round).join(','));
        const key = `${boxes.join('|')}@${vw}x${vh}`;
        if (key !== painted) {
          painted = key;
          paintVeil(veil, catcher, rim, windows, masked);
        }
        // What the step asks for wears a ring, clear of its edge, on every step:
        // a control, a shelf to choose from, the way to another page. A window
        // alone read as a slightly lighter patch nobody could find, and a ring
        // on some steps and not others read as two different tutors.
        if (target && t) {
          const words = hugged(target);
          const ringBox = words ?? pad(t, RING_OFFSET);
          Object.assign(ring.style, {
            left: `${ringBox.left}px`,
            top: `${ringBox.top}px`,
            width: `${width(ringBox)}px`,
            height: `${height(ringBox)}px`,
            borderRadius: `${words ? HUG_RADIUS : cornerRadius(target) + RING_OFFSET}px`,
          });
          ring.hidden = false;
        } else ring.hidden = true;
      }

      // The card's own height, for a surface that has to make room for it (the
      // open picker on a phone, attach-panel.css).
      if (card) document.documentElement.style.setProperty('--sc-coach-h', `${Math.round(card.offsetHeight)}px`);
      if (card && centred) {
        card.style.right = '';
        card.style.left = `${Math.round((vw - card.offsetWidth) / 2)}px`;
        card.style.top = `${Math.round((vh - card.offsetHeight) / 2)}px`;
        card.dataset.side = 'centre';
        if (pointer) pointer.hidden = true;
      }
      if (card && pointer && target && t) {
        card.style.right = '';
        // The bars the page pins to its top and bottom are not room for the card.
        const room = {
          top: EDGE + barAbove(chrome, vh),
          bottom: EDGE + barBelow(chrome, vh),
          left: EDGE,
          right: EDGE,
        };
        // One column of room is not a side: on a phone a card asked to stand
        // beside a surface stands above or below it instead, against the thing
        // it points at, rather than being squeezed over the middle of it.
        const wideScreen = vw >= NARROW;
        const upright: Side = side === 'left' || side === 'right' ? 'top' : side;
        // A card under a surface as wide as the screen hangs from its leading
        // edge, the way a menu hangs from its button: centred under something
        // that wide, it reads as a scrap floating in the middle of nowhere.
        const broad = !wideScreen && width(t) > vw * 0.6;
        const want: Placement = wideScreen ? side : broad ? `${upright}-start` : upright;
        const place = (ref: Box, fallbacks: Placement[] | undefined) =>
          computePosition(virtual(ref, target), card, {
            strategy: 'fixed',
            placement: last ?? want,
            middleware: [
              offset(GAP),
              flip({ padding: room, fallbackPlacements: fallbacks }),
              shift({ padding: room }),
              arrow({ element: pointer, padding: ARROW_INSET }),
            ],
          });
        // What the card must stay off: the control it points at, and on a
        // phone the whole lit surface, because the sentence that explains the
        // control is part of it and a card over that explains nothing. It
        // keeps the control's own width, so the pointer still lands on the
        // control rather than on the middle of the surface around it.
        const keep = !wideScreen && r ? { ...t, top: r.top, bottom: r.bottom } : t;
        const covers = (x: number, y: number) =>
          intersects(
            { left: x, top: y, right: x + card.offsetWidth, bottom: y + card.offsetHeight },
            pad(keep, RING_OFFSET),
          );
        // A card beside its target, on a screen too narrow for either side, goes
        // above it instead, and only below it when there is no room up there.
        const sideways = wideScreen && (side === 'left' || side === 'right');
        // The other side keeps the alignment the first one had, or a card that
        // hangs from an edge jumps to the middle the moment it flips.
        const other: Placement[] = broad ? ['bottom-start', 'top-start'] : ['bottom', 'top'];
        const fallbacks: Placement[] | undefined = sideways
          ? [opposite(side), 'top', 'bottom']
          : wideScreen
            ? undefined
            : other;

        // A note on a target as tall as the screen (one finished shot filling
        // the feed) has no room above or below it: it comes inside, on the
        // picture's own bottom edge, where it reads as a caption. An ask never
        // does that: what it points at has to stay usable.
        const huge = !coach && height(t) > vh * 0.6;
        // A card beside a whole surface (the picker, a dialog, a question) clears
        // that surface; a card for one control sits against that control, so
        // its pointer lands on the thing being asked for and not on the box
        // around it.
        // A moment about one control sits against that control, so its pointer
        // lands on the thing being asked for. A moment that leaves a whole
        // surface usable (a picker, a dialog, or the brief beside Generate)
        // clears that surface instead, so it covers none of it.
        const wide = wideScreen && (p.beside || live.length > 1);
        const ref = huge ? { ...t, top: t.bottom - 1 } : wide ? referenceRect(t, r, side) : keep;
        let res = await place(ref, huge ? ['top'] : fallbacks);
        if (!alive || my !== token) return;
        if (!huge && covers(res.x, res.y)) {
          res = await place(keep, undefined);
          if (!alive || my !== token) return;
        }
        // On a small phone with the keyboard up there may be no room that leaves
        // the target clear. The card waits, out of the way, for the room to come back.
        if (!huge && covers(res.x, res.y)) return setPhase('stowed');

        last = res.placement;
        const placed = res.placement.split('-')[0] as Side;
        card.style.left = `${Math.round(res.x)}px`;
        card.style.top = `${Math.round(res.y)}px`;
        card.dataset.side = placed;
        const a = res.middlewareData.arrow;
        pointer.dataset.edge = opposite(placed);
        pointer.style.left = a?.x != null ? `${a.x}px` : '';
        pointer.style.top = a?.y != null ? `${a.y}px` : '';
        pointer.hidden = !a || Math.abs(a.centerOffset) > 1;
      }

      if (coach && !held) {
        hold();
        held = true;
      }
      if (!shown) {
        // A surface still growing in (the picker, a dialog, the page arriving)
        // is measured where it lands, not mid-flight: placed mid-flight, the
        // card was shown on one side and jumped to the other a frame later.
        if (arriving([...(target ? [target] : []), ...live]) && ++waited < ARRIVE_TRIES) {
          window.setTimeout(schedule, STEADY_MS);
          return;
        }
        const here = [...(target ? [target] : []), ...live, ...also, ...lit]
          .map((el) => {
            const b = el.getBoundingClientRect();
            return [b.left, b.top, b.right, b.bottom].map(Math.round).join(',');
          })
          .join('|');
        if (here !== steadyKey) {
          steadyKey = here;
          steady = 0;
        }
        if (++steady < 2 && steady < STEADY_TRIES) {
          window.setTimeout(schedule, STEADY_MS);
          return;
        }
      }
      setPhase('shown');
      if (!shown) {
        shown = true;
        settle();
        watch();
      }
    };

    /**
     * For a moment after it shows, where the step is keeps being checked: a
     * page that has just arrived can still shift under it with nothing
     * animating (the composer settling 19px higher once its row loaded), which
     * nothing else reports, and a card placed a beat early sat on the control
     * it pointed at.
     */
    let watching = 0;
    const watch = () => {
      const el = target ?? live[0];
      if (!el) return;
      let at = el.getBoundingClientRect();
      const until = performance.now() + WATCH_MS;
      const look = () => {
        if (!alive) return;
        const now = el.getBoundingClientRect();
        if (now.top !== at.top || now.left !== at.left || now.height !== at.height) {
          at = now;
          schedule();
        }
        if (performance.now() < until) watching = requestAnimationFrame(look);
      };
      watching = requestAnimationFrame(look);
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void update());
    };

    // The first time a step is on screen: focus, for a coach card only, and the announcement.
    const settle = () => {
      everShown.current = true;
      let moved = false;
      if (coach && card) {
        const inLive = (n: Element | null) => !!n && live.some((s) => s.contains(n));
        const active = document.activeElement;
        // An ask for words takes the caret to where the words go: being told to
        // write and then having to click first is a step nobody should take.
        const field = live.find((el) => el.matches(WRITABLE)) ?? null;
        // A card button that handed the caret to a live control leaves it there.
        if (pressed.current && inLive(active)) pressed.current = null;
        else if (pressed.current) {
          const again = pressed.current === 'back' ? backRef.current : null;
          (again ?? actionRef.current ?? card).focus({ preventScroll: true });
          pressed.current = null;
        } else if (field && !inLive(active)) caretToEnd(field);
        else if (!active || active === document.body || active.closest('[inert]')) {
          // Focus that is lost (on the page's body, or on something now held)
          // comes to the card; focus the person put in a live control stays.
          card.focus({ preventScroll: true });
          moved = true;
        }
      }
      onShown(id, moved);
    };

    // Fade out what was showing, change the words, bring a target below the
    // fold up once in its own pane, and only then place the card and fade it in.
    const fade = everShown.current && !still && hasCard && shownId.current !== id ? FADE_MS : 0;
    shownId.current = id;
    void wait(fade)
      .then(() => {
        if (!alive) return;
        flushSync(() => setView(viewOf(latest.current)));
        return target ? bringIntoView(target, pane, still) : undefined;
      })
      .then(() => {
        if (!alive) return;
        stopAuto = autoUpdate(lead, card ?? veil ?? lead, schedule);
      });
    const ro = new ResizeObserver(schedule);
    for (const el of live) ro.observe(el);
    if (target) ro.observe(target);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    // The page goes on drawing under a held page: a question writes itself in,
    // the brief opens its `$` menu. What arrives after the hold is held too, or
    // kept when it belongs to the step, so nothing new is reachable by Tab.
    let rehold = 0;
    const arrivals = coach
      ? new MutationObserver(() => {
          if (!held) return;
          cancelAnimationFrame(rehold);
          rehold = requestAnimationFrame(hold);
        })
      : null;
    arrivals?.observe(container, { childList: true, subtree: true });

    return () => {
      alive = false;
      document.documentElement.style.removeProperty('--sc-coach-h');
      cancelAnimationFrame(frame);
      cancelAnimationFrame(watching);
      cancelAnimationFrame(rehold);
      arrivals?.disconnect();
      stopAuto?.();
      ro.disconnect();
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [id, coach, hasCard, target, liveKey, alsoKey, litKey, side, container, onShown, masked]);

  // The card's words describe the control while it is the one being pointed at.
  useEffect(() => {
    if (!hasCard || !target || !focusable(target)) return;
    const ids = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    if (ids.includes(bodyId)) return;
    target.setAttribute('aria-describedby', [...ids, bodyId].join(' '));
    return () => {
      const now = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((x) => x && x !== bodyId);
      if (now.length) target.setAttribute('aria-describedby', now.join(' '));
      else target.removeAttribute('aria-describedby');
    };
  }, [hasCard, target, bodyId]);

  // An ask's keys belong to it and to what it left usable. Escape ends the
  // guidance; nothing pressed on the card or the page behind reaches the
  // page's own shortcuts. A note leaves every key to the page.
  const { onEscape } = p;
  useEffect(() => {
    if (!coach) return;
    const inSurfaces = (n: Node | null) => !!n && live.some((s) => s.contains(n));
    const onKey = (e: KeyboardEvent) => {
      const card = cardRef.current;
      const from = e.target instanceof Node ? e.target : null;
      const inSurface = inSurfaces(from);
      const active = document.activeElement;
      if (e.key === 'Escape') {
        // A surface that answered the key itself (the picker closing) has had it.
        if (e.defaultPrevented) return;
        if (active?.closest('[role="dialog"]:not(.sc-coach):not(.sc-attachpanel)')) return;
        if (
          inSurface &&
          active?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]')
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        onEscape(id);
        return;
      }
      if (inSurface) return;
      if (
        !from ||
        from === document.body ||
        from === document.documentElement ||
        card?.contains(from) ||
        catchRef.current?.contains(from)
      )
        e.stopPropagation();
    };
    // Focus that falls to nothing (a menu handing it back to a control the
    // coach has made inert) comes to the card rather than leaving the reader
    // lost. A press inside a live surface is left to that surface.
    let frame = 0;
    let pressInSurface = false;
    const onDown = (e: PointerEvent) => {
      pressInSurface = e.target instanceof Node && inSurfaces(e.target);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget || pressInSurface || !cardRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Tab past the last control leaves for the browser's own chrome: that is the reader's choice.
        if (!document.hasFocus()) return;
        const active = document.activeElement;
        if (!active || active === document.body || active.closest('[inert]'))
          cardRef.current?.focus({ preventScroll: true });
      });
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    document.addEventListener('focusout', onFocusOut, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('focusout', onFocusOut, true);
    };
  }, [id, coach, liveKey, onEscape]);

  return createPortal(
    <>
      {coach && (
        <>
          <div
            ref={veilRef}
            className="sc-coach-veil"
            data-veil={masked ? 'mask' : 'panels'}
            data-soft={p.soft || undefined}
            data-state={phase}
            aria-hidden="true"
          >
            {PARTS.map((i) => (
              <div key={i} className="sc-coach-panel" />
            ))}
          </div>
          <div
            ref={catchRef}
            className="sc-coach-catch"
            data-guide="catch"
            data-state={phase}
            aria-hidden="true"
            onMouseDown={(e) => e.preventDefault()}
          >
            {PARTS.map((i) => (
              <div key={i} className="sc-coach-catch-part" />
            ))}
          </div>
          <div ref={rimRef} className="sc-coach-rim" data-state={phase} aria-hidden="true" />
          <div ref={ringRef} className="sc-coach-ring" data-state={phase} aria-hidden="true" hidden />
        </>
      )}
      {hasCard && (
        <div
          ref={cardRef}
          className="sc-coach"
          data-guide="card"
          data-voice={coach ? 'coach' : 'card'}
          data-beside={p.beside || undefined}
          // A coach holds the page and takes focus, so it is a dialog; a card only annotates.
          {...(coach ? { role: 'dialog', 'aria-labelledby': v.title ? titleId : undefined } : { role: 'note' })}
          aria-describedby={bodyId}
          tabIndex={-1}
          data-state={phase}
        >
          <div ref={arrowRef} className="sc-coach-arrow" aria-hidden="true" hidden />
          <div className="sc-coach-head">
            {v.title ? (
              <h2 id={titleId} className="sc-coach-title">
                {v.title}
              </h2>
            ) : (
              <p id={bodyId} className="sc-coach-body" data-lead="">
                {v.body}
              </p>
            )}
            {v.count && (
              <p className="sc-coach-count">
                <span className="sc-vh">Step </span>
                {v.count}
              </p>
            )}
            <Tip label={p.closeLabel}>
              <button type="button" className="sc-coach-x" aria-label={p.closeLabel} onClick={() => p.onClose(id)}>
                <X size={16} />
              </button>
            </Tip>
          </div>
          {v.title && v.body && (
            <p id={bodyId} className="sc-coach-body">
              {v.body}
            </p>
          )}
          {(v.canBack || v.action) && (
            <div className="sc-coach-foot">
              {v.canBack && (
                <button
                  ref={backRef}
                  type="button"
                  className="sc-coach-back"
                  onClick={() => {
                    pressed.current = 'back';
                    p.onBack(id);
                  }}
                >
                  Back
                </button>
              )}
              {v.action && (
                <button
                  ref={actionRef}
                  type="button"
                  className="sc-btn sc-btn-primary sc-coach-next"
                  onClick={() => {
                    pressed.current = 'action';
                    p.onAction(id);
                  }}
                >
                  {v.action.label}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>,
    container,
  );
}

/** A stable stand-in for a list of elements, so an effect reruns only when the list really changes. */
/**
 * Focus for writing in: the caret goes to the end of what is already there, so
 * a line that gained chips is carried on from rather than typed into the
 * middle of.
 */
function caretToEnd(el: HTMLElement) {
  el.focus({ preventScroll: true });
  if (!el.isContentEditable) {
    const field = el as HTMLInputElement | HTMLTextAreaElement;
    const at = field.value?.length ?? 0;
    field.setSelectionRange?.(at, at);
    return;
  }
  // The brief's line is the composer's own: its caret lives inside a text
  // node, past the guard after the last chip. A range collapsed on the line
  // itself was drawn by Chrome in the gap before the last chip instead.
  lineCaretToEnd(el);
}

/**
 * What a live control opened and is part of the same moment: its own popover,
 * the phone's settings sheet, a chip's peek. They are lit and usable without
 * any moment having to name them.
 */
function openPoppers(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(POPPERS)].filter((el) => el.getClientRects().length > 0);
}

function useSurfaceKey(surfaces: readonly HTMLElement[]): readonly HTMLElement[] {
  const ref = useRef(surfaces);
  if (ref.current.length !== surfaces.length || ref.current.some((s, i) => s !== surfaces[i])) ref.current = surfaces;
  return ref.current;
}

function occluders(surface: Element, container: Element): Box[] {
  const out: Box[] = [];
  for (const el of document.querySelectorAll(CHROME)) {
    // chrome under a shell that owns the screen is not over anything the guide shows
    if (!container.contains(el)) continue;
    if (el.contains(surface) || surface.contains(el) || el.getClientRects().length === 0) continue;
    out.push(boxOf(el.getBoundingClientRect()));
  }
  return out;
}

/** How far a bar pinned to the top of the screen reaches down. */
function barAbove(chrome: Box[], vh: number): number {
  return Math.max(0, ...chrome.filter((c) => c.top <= 0 && c.bottom < vh / 3).map((c) => c.bottom));
}

/** How far a bar pinned to the bottom of the screen reaches up. */
function barBelow(chrome: Box[], vh: number): number {
  return Math.max(0, ...chrome.filter((c) => c.bottom >= vh && c.top > (vh * 2) / 3).map((c) => vh - c.top));
}

/** Floating UI's reference: a box of our choosing, scrolled with the target's own ancestors. */
function virtual(b: Box, context: Element): VirtualElement {
  const rect = {
    x: b.left,
    y: b.top,
    left: b.left,
    top: b.top,
    right: b.right,
    bottom: b.bottom,
    width: width(b),
    height: height(b),
  };
  return { getBoundingClientRect: () => rect, contextElement: context };
}

/**
 * The veil paints; it never takes a press. With a mask every window is cut
 * from the dim and the blur alike, and the rim traces the windows' outer edge;
 * without one, plain panels frame the windows' union. Either way the clear
 * catch panels around the union are what the page's presses land on.
 */
function paintVeil(veil: HTMLElement, catcher: HTMLElement, rim: HTMLElement, windows: Window[], masked: boolean) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const all = windows.reduce<Box | null>((u, w) => (u ? union(u, w) : w), null);
  const parts = all ? panels(all, vw, vh) : [];
  if (masked) {
    const image = windowsMask(windows, vw, vh);
    const s = veil.style;
    s.maskImage = image;
    s.webkitMaskImage = image;
    rim.style.backgroundImage = windowsRim(windows, vw, vh, RIM);
  } else placeParts(veil, parts);
  placeParts(catcher, parts);
}

/** A shape's corner, as drawn: the top-left radius, which every shape the guide windows uses shares. */
function cornerRadius(el: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
}

function placeParts(host: HTMLElement, parts: Box[]) {
  Array.from(host.children).forEach((el, i) => {
    const b = parts[i];
    const s = (el as HTMLElement).style;
    if (!b) {
      s.display = 'none';
      return;
    }
    Object.assign(s, {
      display: 'block',
      left: `${b.left}px`,
      top: `${b.top}px`,
      width: `${width(b)}px`,
      height: `${height(b)}px`,
    });
  });
}

const PARTS = [0, 1, 2, 3];

function maskSupported(): boolean {
  if (typeof CSS === 'undefined') return false;
  return CSS.supports('mask-image', 'url("x.svg")') || CSS.supports('-webkit-mask-image', 'url("x.svg")');
}

/** The pane a target scrolls in. Inside a brand the document never scrolls; a page does. */
function scrollPane(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/**
 * Brings a target mostly out of view into its pane, once. Only that pane
 * scrolls, never the shell around it, and a target taller than the pane shows
 * from its top rather than from somewhere in its middle.
 */
function bringIntoView(target: HTMLElement, pane: HTMLElement | null, still: boolean): Promise<void> {
  if (!pane) return Promise.resolve();
  const tr = target.getBoundingClientRect();
  const pr = pane.getBoundingClientRect();
  const seen = Math.max(0, Math.min(tr.bottom, pr.bottom, window.innerHeight) - Math.max(tr.top, pr.top, 0));
  if (seen >= Math.min(120, tr.height * 0.4)) return Promise.resolve();
  const tall = tr.height > pr.height * 0.8;
  const delta = tall ? tr.top - pr.top - 16 : (tr.top + tr.bottom) / 2 - (pr.top + pr.bottom) / 2;
  pane.scrollBy({ top: delta, behavior: still ? 'auto' : 'smooth' });
  if (still) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pane.removeEventListener('scrollend', finish);
      resolve();
    };
    pane.addEventListener('scrollend', finish);
    window.setTimeout(finish, SCROLL_WAIT_MS);
  });
}

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => window.setTimeout(resolve, ms)) : Promise.resolve();
}

function focusable(el: HTMLElement): boolean {
  return el.matches('button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]');
}

/** A control far taller than its words (a place in the top bar) is ringed around the words. */
const HUG_RADIUS = 10;
function hugged(el: HTMLElement): Box | null {
  if (!el.matches('a[href], button') || el.getBoundingClientRect().height <= 48) return null;
  const range = document.createRange();
  range.selectNodeContents(el);
  const b = range.getBoundingClientRect();
  if (!b.width) return null;
  return { left: b.left - 12, top: b.top - 7, right: b.right + 12, bottom: b.bottom + 7 };
}

/**
 * Something that holds what the step is about is still moving: an animation
 * running on it or around it. Never the coach's own ring, which breathes for
 * as long as it is there.
 */
function arriving(els: readonly HTMLElement[]): boolean {
  return document.getAnimations().some((a) => {
    const on = (a.effect as KeyframeEffect | null)?.target;
    if (!(on instanceof Element) || a.playState !== 'running') return false;
    if (a.effect?.getTiming().iterations === Number.POSITIVE_INFINITY) return false;
    return els.some((el) => on.contains(el));
  });
}
