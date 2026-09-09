import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type Answer, type Turn, prefersReducedMotion, revealPlan, turnKey } from './question.js';
import { PICK_MS, type Picked, QuestionBlock } from './QuestionBlock.js';
import { ScenriTurn } from './ScenriTurn.js';
import { YouTurn } from './YouTurn.js';

/** The beat a turn takes to go when it leaves: a reverted answer, a question that is over. */
export const LEAVE_MS = 180;

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
  onAnswer,
  onEdit,
  onExpand,
  onStarter,
}: {
  turns: Turn[];
  busy?: boolean;
  /** Where what has been said is remembered, so a line arrives once. */
  memoryKey?: string;
  onAnswer: (questionId: string, answer: Answer) => void;
  onEdit?: (turnId: string) => void;
  /** The folded setup stretch was pressed. */
  onExpand?: () => void;
  onStarter?: (text: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const reduced = prefersReducedMotion();

  // A turn that goes is seen going. The state moved the moment it changed;
  // the picture takes a beat: a reverted answer fades, a block that was
  // tapped keeps its ghost (the chosen control lit, the row fading), and what
  // comes next waits until it is gone. Folding and unfolding the setup is
  // not going anywhere, and plays nothing.
  const shown = useRef<Turn[]>(turns);
  const leave = useRef<Leaving | null>(null);
  const look = useRef<{ qid: string; look: Picked } | null>(null);
  const gone = useRef<string[]>([]);
  const [, tick] = useState(0);
  const now = performance.now();
  if (turns !== shown.current) {
    const prev = shown.current;
    const cur = new Set(turns.map(turnKey));
    const left = prev.map(turnKey).filter((k) => !cur.has(k));
    const folds = (list: Turn[]) => list.some((t) => t.kind === 'summary');
    gone.current = folds(prev) === folds(turns) ? left : [];
    if (!reduced && gone.current.length) {
      const picked = look.current;
      leave.current = {
        from: prev,
        gone: new Set(gone.current),
        look: picked,
        until: now + (picked ? PICK_MS : LEAVE_MS),
      };
    } else leave.current = null;
    look.current = null;
    shown.current = turns;
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
  const list = leaving ? leaving.from : turns;

  // A line arrives once, when it is written. What has been said is remembered
  // for the conversation (session storage under `memoryKey`), so a reload, a
  // fold and unfold or a remount never replay it; a turn that left is
  // forgotten, so a question asked again or an answer given again arrives
  // again. A conversation opened with its history already long plays nothing
  // on arrival.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) {
    const stored = memoryKey ? readSaid(memoryKey) : null;
    seen.current = stored ?? new Set(turns.length > 2 ? turns.map(turnKey) : []);
  }
  const fresh = new Set<string>();
  for (const t of list) {
    const k = turnKey(t);
    if (!seen.current.has(k)) fresh.add(k);
  }
  useEffect(() => {
    const set = seen.current;
    if (!set) return;
    for (const k of gone.current) set.delete(k);
    for (const t of list) {
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

  let firstYou = true;
  let prevScenri = false;
  // Lines that arrive together take their turns, one after the other.
  let offset = 0;
  const out: ReactNode[] = [];
  for (const t of list) {
    const k = turnKey(t);
    const going = !!leaving?.gone.has(k);
    // a block that was tapped goes as its ghost, not as a fade
    const ghost = going && t.kind === 'question' && leaving?.look?.qid === t.question.id;
    // A line already read as a question does not arrive again as its record.
    const seenAsQuestion = t.kind === 'scenri' && t.id.startsWith('asked-');
    const reveal = !reduced && !going && fresh.has(k) && !seenAsQuestion;
    const delay = reveal ? offset : 0;
    if (reveal && t.kind === 'scenri') offset += revealPlan(t.text).total;
    if (reveal && t.kind === 'question') offset += revealPlan(t.question.prompt).total;
    const afterScenri = prevScenri;
    prevScenri = t.kind === 'scenri' || t.kind === 'question';
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
          delay={delay}
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
