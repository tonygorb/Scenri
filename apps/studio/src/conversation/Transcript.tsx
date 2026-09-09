import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type Answer, type Question, type Turn, prefersReducedMotion, revealPlan, turnKey } from './question.js';
import { PICK_MS, type Picked, QuestionBlock } from './QuestionBlock.js';
import { ScenriTurn } from './ScenriTurn.js';
import { YouTurn } from './YouTurn.js';

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

  // A tap is seen before its answer takes the block's place: the answer is
  // taken at once, and a ghost of the block stands where it was for a beat,
  // its chosen control lit and its row going. What arrives after waits for it.
  const [ghost, setGhost] = useState<{ question: Question; look: Picked } | null>(null);
  const ghostTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (ghostTimer.current) window.clearTimeout(ghostTimer.current);
    },
    [],
  );
  const onPick = (question: Question, look: Picked) => {
    if (reduced) return;
    setGhost({ question, look });
    if (ghostTimer.current) window.clearTimeout(ghostTimer.current);
    ghostTimer.current = window.setTimeout(() => setGhost(null), PICK_MS);
  };

  // A line arrives once, when it is written. What has been said is remembered
  // for the conversation (session storage under `memoryKey`), so a reload, a
  // fold and unfold or a remount never replay it. A conversation opened with
  // its history already long plays nothing on arrival.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) {
    const stored = memoryKey ? readSaid(memoryKey) : null;
    seen.current = stored ?? new Set(turns.length > 2 ? turns.map(turnKey) : []);
  }
  const fresh = new Set<string>();
  for (const t of turns) {
    const k = turnKey(t);
    if (!seen.current.has(k)) fresh.add(k);
  }
  useEffect(() => {
    const set = seen.current;
    if (!set) return;
    for (const t of turns) set.add(turnKey(t));
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
  // Lines that arrive together take their turns, one after the other; after a
  // tap, everything waits for the ghost to go.
  let offset = ghost ? PICK_MS : 0;
  let ghostPlaced = false;
  const ghostBlock = (eyebrow: boolean): ReactNode =>
    ghost ? (
      <QuestionBlock
        key={`ghost:${ghost.question.id}`}
        question={ghost.question}
        ghost={ghost.look}
        eyebrow={eyebrow}
        onAnswer={noop}
      />
    ) : null;
  const out: ReactNode[] = [];
  for (const t of turns) {
    const k = turnKey(t);
    // A line already read as a question does not arrive again as its record.
    const seenAsQuestion = t.kind === 'scenri' && t.id.startsWith('asked-');
    const isGhostsLine = !!ghost && seenAsQuestion && t.id === `asked-${ghost.question.id}`;
    // the ghost stands where its block was: in place of its own line, else before whatever is new
    if (ghost && !ghostPlaced && (isGhostsLine || fresh.has(k))) {
      out.push(ghostBlock(!prevScenri));
      ghostPlaced = true;
      prevScenri = true;
      if (isGhostsLine) continue;
    }
    const reveal = !reduced && fresh.has(k) && !seenAsQuestion;
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
          delay={delay}
          onEdit={t.editable && onEdit ? () => onEdit(t.id) : undefined}
        />,
      );
    } else if (t.kind === 'scenri') {
      out.push(<ScenriTurn key={k} text={t.text} tone={t.tone} reveal={reveal} eyebrow={!afterScenri} delay={delay} />);
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
  if (ghost && !ghostPlaced) out.push(ghostBlock(!prevScenri));
  return (
    <div ref={box} className="sc-convo-log" role="log" aria-live="polite" aria-relevant="additions">
      <div className="sc-convo-turns">{out}</div>
    </div>
  );
}

const noop = () => undefined;

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
