import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { REVEAL_LEAD_MS, THINK_MS, type Answer, type Turn, prefersReducedMotion, turnKey } from './question.js';
import { PICK_MS, type Picked, QuestionBlock } from './QuestionBlock.js';
import { ScenriTurn } from './ScenriTurn.js';
import { YouTurn } from './YouTurn.js';

/** The beat a turn takes to go when it leaves: a reverted answer, a question that is over. */
export const LEAVE_MS = 180;

/**
 * How long a page opened on a conversation takes its history as read. The draft
 * and its record arrive over several renders, so a single first batch is not
 * the whole of it; anything the person does ends the window at once.
 */
const SETTLE_MS = 3000;

/**
 * How a turn that stays moves when the ones around it change: the distance it
 * has to travel, played back from where it was. Long enough to read as one
 * movement, and eased like a thing with weight rather than a fade.
 */
const SLIDE_MS = 460;
/**
 * The curve a turn travels on: a spring that is critically damped, so it
 * carries weight and settles without ever going past where it is headed. No
 * bounce.
 */
const SLIDE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** How long an answer of your own holds the floor before the reply begins. */
const ANSWER_MS = 220;

interface Leaving {
  /** The turns as they were, with the ones that are going marked. */
  from: Turn[];
  gone: Set<string>;
  /** The answered block's look, when what is going is a block that was tapped. */
  look: { qid: string; look: Picked } | null;
  until: number;
}

/**
 * The transcript: turns, bottom-anchored, one scroll region.
 *
 * It is a rendering of state and holds none of its own: the flow hands it
 * the turns on every render, and the turns carry stable keys, so a turn that
 * was on screen last render is the same node this render and only a new one
 * plays its arrival. A polite live region announces a finished turn once.
 * The newest turn stays in view unless the reader has scrolled up to read.
 */
export function Transcript({
  turns,
  busy,
  memoryKey,
  resumed,
  onAnswer,
  onEdit,
  onExpand,
  onStarter,
  onRestore,
}: {
  turns: Turn[];
  busy?: boolean;
  /** Where what has been said is remembered, so a line arrives once. */
  memoryKey?: string;
  /** The page opened on a conversation that was already had: none of it is written out again. */
  resumed?: boolean;
  onAnswer: (questionId: string, answer: Answer) => void;
  onEdit?: (turnId: string) => void;
  /** The folded setup stretch was pressed. */
  onExpand?: () => void;
  onStarter?: (text: string) => void;
  /** A picture from before, put back on its view. */
  onRestore?: (view: string, hash: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // How long a page that opened on a conversation stays quiet: long enough for
  // the draft and its record to land, over as soon as the person acts.
  const settling = useRef(!!resumed);
  const opened = useRef(performance.now());
  if (settling.current && performance.now() - opened.current > SETTLE_MS) settling.current = false;
  useEffect(() => {
    if (!settling.current) return;
    const done = () => {
      settling.current = false;
    };
    const t = window.setTimeout(done, SETTLE_MS);
    window.addEventListener('pointerdown', done, { capture: true });
    window.addEventListener('keydown', done, { capture: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', done, { capture: true });
      window.removeEventListener('keydown', done, { capture: true });
    };
  }, []);
  const reduced = prefersReducedMotion();

  // A turn that goes is seen going. The state moved the moment it changed;
  // the picture takes a beat: a reverted answer fades, a block that was
  // tapped keeps its ghost (the chosen control lit, the row fading), and what
  // comes next waits until it is gone. Folding and unfolding the setup is
  // not going anywhere, and plays nothing.
  const last = useRef<Turn[]>(turns);
  const rendered = useRef<Turn[]>(turns);
  const leave = useRef<Leaving | null>(null);
  const look = useRef<{ qid: string; look: Picked } | null>(null);
  const gone = useRef<string[]>([]);
  const [, tick] = useState(0);
  // when each turn may take its place on screen, by key, and the moment the
  // next one after them may
  const due = useRef(new Map<string, number>());
  const free = useRef(0);
  const now = performance.now();
  if (turns !== last.current) {
    // against what is on screen, so a change landing mid-fade keeps the fade going
    const prev = rendered.current;
    const cur = new Set(turns.map(turnKey));
    const left = prev.map(turnKey).filter((k) => !cur.has(k));
    const folds = (list: Turn[]) => list.some((t) => t.kind === 'summary');
    gone.current = folds(prev) === folds(turns) ? left : [];
    if (!reduced && gone.current.length) {
      const kept = leave.current?.look && left.includes(`q:${leave.current.look.qid}`) ? leave.current.look : null;
      const picked = look.current ?? kept;
      leave.current = {
        from: prev,
        gone: new Set(gone.current),
        look: picked,
        until: now + (look.current ? PICK_MS : LEAVE_MS),
      };
    } else leave.current = null;
    look.current = null;
    last.current = turns;
  }
  const leaving = leave.current && now < leave.current.until ? leave.current : null;
  if (!leaving) leave.current = null;
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => tick((n) => n + 1), Math.max(0, leaving.until - performance.now()));
    return () => window.clearTimeout(t);
  }, [leaving]);
  const onPick = (qid: string, picked: Picked) => {
    look.current = { qid, look: picked };
  };
  // What is on screen while a turn goes: the turns as they are now, with the
  // ones that are going put back where they were. The picture never waits on
  // a timer to be right; a beat that is missed costs a fade, never a line.
  const list = leaving ? withLeaving(turns, leaving) : turns;
  // and what arrives waits for the ones going to be gone, as it did when they
  // were the whole picture

  // A line arrives once, when it is written. What has been said is remembered
  // for the conversation (session storage under `memoryKey`), so a reload, a
  // fold and unfold or a remount never replay it; a turn that left is
  // forgotten, so a question asked again or an answer given again arrives
  // again. A conversation opened with its history already long plays nothing
  // on arrival.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) {
    const stored = memoryKey ? readSaid(memoryKey) : null;
    seen.current = stored ?? new Set(resumed || turns.length > 2 ? turns.map(turnKey) : []);
  }
  const fresh = new Set<string>();
  for (const t of list) {
    const k = turnKey(t);
    if (!seen.current.has(k)) fresh.add(k);
  }
  // A conversation that was already had is not had again. A page opened on a
  // draft gets its history a moment later and in more than one go: the draft
  // answers, then the pictures it names, then whatever settles after them. All
  // of it is taken as read while the page is still settling, and the moment the
  // person touches anything, or the settling window is over, the conversation
  // writes itself out as it happens again.
  if (resumed && settling.current && fresh.size) {
    for (const k of fresh) seen.current.add(k);
    fresh.clear();
  }
  // Turns take their places one at a time. A line that has not had its beat yet
  // is not on the screen at all: it used to be there from the first frame, at
  // full height and invisible, so answering a question moved the conversation
  // by the whole of what was coming before any of it could be read. Each turn
  // now waits for the one before it, and for whatever is leaving to be gone.
  const shown: Turn[] = [];
  let soonest = Number.POSITIVE_INFINITY;
  {
    const here = new Set(list.map(turnKey));
    for (const k of [...due.current.keys()]) if (!here.has(k)) due.current.delete(k);
    for (const t of list) {
      const k = turnKey(t);
      if (!fresh.has(k)) {
        shown.push(t);
        continue;
      }
      // The setup folding into its one row is not a line arriving: it stands in
      // for what it replaces, so it takes its place in the same breath. Your own
      // words are yours and appear at once as well; only Scenri's lines wait
      // their turn behind one another.
      if (t.kind === 'summary') {
        shown.push(t);
        continue;
      }
      let at = due.current.get(k);
      if (at === undefined) {
        // the floor is kept between renders: a line that lands while an earlier
        // one is still being read waits for it, however many renders apart
        const mine = t.kind === 'you';
        at = Math.max(now, mine ? 0 : free.current, leaving?.until ?? 0);
        due.current.set(k, at);
        free.current = Math.max(free.current, at + (mine ? ANSWER_MS : THINK_MS + REVEAL_LEAD_MS));
      }
      if (at <= now) shown.push(t);
      else soonest = Math.min(soonest, at - now);
    }
  }
  rendered.current = shown;
  useEffect(() => {
    if (soonest === Number.POSITIVE_INFINITY) return;
    const t = window.setTimeout(() => tick((n) => n + 1), soonest);
    return () => window.clearTimeout(t);
  }, [soonest]);

  useEffect(() => {
    const set = seen.current;
    if (!set) return;
    for (const k of gone.current) set.delete(k);
    for (const t of shown) {
      const k = turnKey(t);
      if (!leaving?.gone.has(k)) set.add(k);
    }
    if (memoryKey) writeSaid(memoryKey, set);
  });

  // The newest turn stays in view unless the reader scrolled up to read. On a
  // desktop the log is the scroller; on a phone the studio column is, so the
  // nearest scrolling ancestor is what moves and what is watched.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const parent = scrollParent(el);
    const onScroll = () => {
      pinned.current = parent.scrollHeight - parent.scrollTop - parent.clientHeight < 24;
    };
    parent.addEventListener('scroll', onScroll, { passive: true });
    return () => parent.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !pinned.current) return;
    const parent = scrollParent(el);
    parent.scrollTop = parent.scrollHeight;
  });

  // Nothing is teleported. A turn that was on screen last render and is
  // somewhere else this one is put back where it was and played forward to
  // where it is now, so a block arriving or going reads as the conversation
  // moving rather than as the page jumping. Turns arriving play their own
  // arrival and are left alone; under reduced motion nothing moves at all.
  const spots = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const next = new Map<string, number>();
    for (const node of el.querySelectorAll<HTMLElement>('.sc-convo-turn')) {
      const key = node.dataset.turn ?? '';
      const at = node.offsetTop;
      next.set(key, at);
      const was = spots.current.get(key);
      // a turn seen here for the first time plays its own arrival; everything
      // else that has moved is played back from where it was
      if (reduced || was === undefined || Math.abs(was - at) < 1) continue;
      slide(node, was - at);
    }
    spots.current = next;
  });

  let firstYou = true;
  let prevScenri = false;
  const out: ReactNode[] = [];
  for (const t of shown) {
    const k = turnKey(t);
    const going = !!leaving?.gone.has(k);
    // a block that was tapped goes as its ghost, not as a fade
    const ghost = going && t.kind === 'question' && leaving?.look?.qid === t.question.id;
    // A line already read as a question does not arrive again as its record.
    const seenAsQuestion = t.kind === 'scenri' && t.id.startsWith('asked-');
    const reveal = !reduced && !going && fresh.has(k) && !seenAsQuestion;
    // a turn is put on screen when its beat comes, so it arrives from nothing
    // rather than waiting its turn invisibly at full height
    const delay = 0;
    const afterScenri = prevScenri;
    // a turn on its way out does not decide whether the next one carries the
    // eyebrow: it used to, so the line under a ghost grew by a whole row the
    // moment the ghost was taken away
    if (!going) prevScenri = t.kind === 'scenri' || t.kind === 'question';
    if (t.kind === 'you') {
      const first = firstYou;
      firstYou = false;
      out.push(
        <YouTurn
          key={k}
          text={t.text}
          photos={t.photos}
          editable={t.editable}
          first={first}
          arrive={reveal}
          leave={going}
          delay={delay}
          turnId={k}
          onEdit={t.editable && onEdit ? () => onEdit(t.id) : undefined}
        />,
      );
    } else if (t.kind === 'scenri') {
      out.push(
        <ScenriTurn
          key={k}
          text={t.text}
          tone={t.tone}
          reveal={reveal}
          leave={going}
          eyebrow={!afterScenri}
          delay={delay}
          turnId={k}
          thumb={t.thumb}
          label={t.label}
          current={t.current}
          restore={t.restore}
          onRestore={onRestore}
        />,
      );
    } else if (t.kind === 'summary') {
      out.push(
        <button key={k} type="button" className="sc-convo-summary" onClick={onExpand}>
          {t.text}
        </button>,
      );
    } else {
      out.push(
        <QuestionBlock
          key={k}
          question={t.question}
          reveal={reveal}
          leave={going && !ghost}
          spent={going}
          delay={delay}
          turnId={k}
          busy={busy}
          eyebrow={!afterScenri}
          onAnswer={(a) => onAnswer(t.question.id, a)}
          onPick={onPick}
          onStarter={onStarter}
        />,
      );
    }
  }
  return (
    <div ref={box} className="sc-convo-log" role="log" aria-live="polite" aria-relevant="additions">
      <div className="sc-convo-turns">{out}</div>
    </div>
  );
}

/**
 * The turns to render while some are going: the current ones, with the ones
 * on their way out back in the places they held.
 */
function withLeaving(cur: Turn[], leaving: Leaving): Turn[] {
  const out: Turn[] = [];
  const live = new Set(cur.map(turnKey));
  let i = 0;
  for (const t of leaving.from) {
    const k = turnKey(t);
    // a turn that went and is already back is one turn, in its place now
    if (leaving.gone.has(k)) {
      if (!live.has(k)) out.push(t);
      continue;
    }
    while (i < cur.length && turnKey(cur[i]) !== k) out.push(cur[i++] as Turn);
    if (i < cur.length) out.push(cur[i++] as Turn);
  }
  while (i < cur.length) out.push(cur[i++] as Turn);
  return out;
}

/**
 * Put a turn back where it was and play it forward to where it is now. The
 * offset is written before the browser paints, so the first frame is the old
 * place: without that, one frame lands at the new place and the movement reads
 * as a jump followed by a slide.
 */
function slide(node: HTMLElement, from: number) {
  // a move that lands while another is still running replaces it, so the turn
  // is never being pulled to two places at once
  for (const old of node.getAnimations()) if (old.id === 'slide') old.cancel();
  const back = `translateY(${from}px)`;
  node.style.transform = back;
  const run = node.animate([{ transform: back }, { transform: 'translateY(0)' }], {
    duration: SLIDE_MS,
    easing: SLIDE_EASE,
    fill: 'both',
  });
  run.id = 'slide';
  run.onfinish = () => {
    node.style.transform = '';
    run.cancel();
  };
}

/** The element that scrolls this one: itself when it overflows, else the nearest ancestor that does. */
function scrollParent(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return el;
}

const saidKey = (memoryKey: string) => `scenri:convo-said:${memoryKey}`;

/** A conversation is over: the next one under this key starts fresh. */
export function forgetSaid(memoryKey: string) {
  try {
    sessionStorage.removeItem(saidKey(memoryKey));
  } catch {
    /* private mode */
  }
}

function readSaid(memoryKey: string): Set<string> | null {
  try {
    const raw = sessionStorage.getItem(saidKey(memoryKey));
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function writeSaid(memoryKey: string, set: Set<string>) {
  try {
    sessionStorage.setItem(saidKey(memoryKey), JSON.stringify([...set]));
  } catch {
    /* private mode */
  }
}
