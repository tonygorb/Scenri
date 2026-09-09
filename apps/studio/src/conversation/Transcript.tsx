import { useEffect, useLayoutEffect, useRef } from 'react';
import { type Answer, type Turn, prefersReducedMotion, turnKey } from './question.js';
import { QuestionBlock } from './QuestionBlock.js';
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
  onAnswer,
  onEdit,
  onExpand,
  onStarter,
}: {
  turns: Turn[];
  busy?: boolean;
  onAnswer: (questionId: string, answer: Answer) => void;
  onEdit?: (turnId: string) => void;
  /** The folded setup stretch was pressed. */
  onExpand?: () => void;
  onStarter?: (text: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string>>(new Set());
  const pinned = useRef(true);
  const reduced = prefersReducedMotion();

  // Which turns are new this render, decided before the DOM commits so the
  // sweep starts on their first frame and never replays on the rest.
  const fresh = new Set<string>();
  for (const t of turns) {
    const k = turnKey(t);
    if (!seen.current.has(k)) fresh.add(k);
  }
  useEffect(() => {
    for (const t of turns) seen.current.add(turnKey(t));
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
  return (
    <div ref={box} className="sc-convo-log" role="log" aria-live="polite" aria-relevant="additions">
      <div className="sc-convo-turns">
        {turns.map((t) => {
          const k = turnKey(t);
          const reveal = !reduced && fresh.has(k);
          const afterScenri = prevScenri;
          prevScenri = t.kind === 'scenri' || t.kind === 'question';
          if (t.kind === 'you') {
            const first = firstYou;
            firstYou = false;
            return (
              <YouTurn
                key={k}
                text={t.text}
                asked={t.asked}
                photos={t.photos}
                editable={t.editable}
                first={first}
                onEdit={t.editable && onEdit ? () => onEdit(t.id) : undefined}
              />
            );
          }
          if (t.kind === 'scenri')
            return <ScenriTurn key={k} text={t.text} tone={t.tone} reveal={reveal} eyebrow={!afterScenri} />;
          if (t.kind === 'summary') {
            return (
              <button key={k} type="button" className="sc-convo-summary" onClick={onExpand}>
                {t.text}
              </button>
            );
          }
          return (
            <QuestionBlock
              key={k}
              question={t.question}
              reveal={reveal}
              busy={busy}
              eyebrow={!afterScenri}
              onAnswer={(a) => onAnswer(t.question.id, a)}
              onStarter={onStarter}
            />
          );
        })}
      </div>
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
