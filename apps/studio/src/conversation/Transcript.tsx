import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { REVEAL_LEAD_MS, THINK_MS, type Answer, type Turn, prefersReducedMotion, turnKey } from './question.js';
import { PICK_MS, type Picked, QuestionBlock } from './QuestionBlock.js';
import { ScenriTurn, Working } from './ScenriTurn.js';
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

/** How long the place of a changed answer stays in view before the reader is moved on. */
const FOLLOW_MS = 450;

/** How much of a block open again may sit under the fold before it is brought up. */
const CUT_OFF = 48;

interface Leaving {
  /** The turns as they were, with the ones that are going marked. */
  from: Turn[];
  gone: Set<string>;
  /** The answered block's look, when what is going is a block that was tapped. */
  look: { qid: string; look: Picked } | null;
  until: number;
}

/**
 * The transcript: turns, top-anchored, one scroll region.
 *
 * It is a rendering of state and holds none of its own: the flow hands it
 * the turns on every render, and the turns carry stable keys, so a turn that
 * was on screen last render is the same node this render and only a new one
 * plays its arrival. What it keeps for itself is presentation: which lines
 * have been said, which are on their way out, when the next may arrive. None
 * of it can change what the turns say. A polite live region announces a
 * finished turn once. The newest turn stays in view unless the reader has
 * scrolled up to read, and a question that opens somewhere else is brought
 * into view rather than the page being thrown to the bottom.
 */
export function Transcript({
  turns,
  busy,
  working,
  memoryKey,
  resumed,
  onAnswer,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onStarter,
  onDescribe,
  onAttachFiles,
  onRestore,
}: {
  turns: Turn[];
  busy?: boolean;
  /**
   * Something is genuinely being waited for, and what it is in a word or two.
   * Never set for a question the flow already has: a line that is ready arrives.
   */
  working?: boolean | string;
  /** Where what has been said is remembered, so a line arrives once. */
  memoryKey?: string;
  /** The page opened on a conversation that was already had: none of it is written out again. */
  resumed?: boolean;
  onAnswer: (questionId: string, answer: Answer) => void;
  onEdit?: (turnId: string) => void;
  /** An answer said again, in the place it was said. */
  onSaveEdit?: (turnId: string, text: string) => void;
  /** An answer open again is left as it was: a rewritten sentence, or a reopened block. */
  onCancelEdit?: () => void;
  onStarter?: (text: string) => void;
  /** A question with things to tap was answered in words instead. */
  onDescribe?: () => void;
  /** A picture chosen from a question, for the answer being written. */
  onAttachFiles?: (files: File[]) => void;

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
  // the question to say again because an answer behind it changed, and what
  // that answer said before it was opened
  const askAgain = useRef<string | null>(null);
  const wasAnswer = useRef<{ key: string; text: string } | null>(null);
  const leave = useRef<Leaving | null>(null);
  const look = useRef<{ qid: string; look: Picked } | null>(null);
  const gone = useRef<string[]>([]);
  const [, tick] = useState(0);
  // when each turn may take its place on screen, by key, and the moment the
  // next one after them may
  const due = useRef(new Map<string, number>());
  const free = useRef(0);
  const now = performance.now();
  // Whether the conversation itself changed this render. A turn that moved
  // because the conversation changed is played back from where it was; one
  // that moved because a font or a picture finished loading is not moving at
  // all, and playing it would be the page appearing to slide for no reason.
  const moved = useRef(false);
  if (turns !== last.current) {
    moved.current = true;
    // What is going is what the turns were and are not any more, plus whatever
    // was still on its way out of them. Diffed against the turns themselves,
    // never against what happened to be painted: a render landing mid-fade
    // used to re-mark the fading turns as newly gone and start their fade
    // again, which could hold a stale row on screen for as long as renders
    // kept coming.
    const fading = leave.current && now < leave.current.until ? leave.current : null;
    const prev = fading ? withLeaving(last.current, fading) : last.current;
    const cur = new Set(turns.map(turnKey));
    // An answer and its question open again are one thing changing shape: the
    // bubble becomes the block and the block becomes the bubble, in place,
    // with no ghost of the one on its way out standing under the other. A
    // question answered for the first time still leaves as its ghost: the tap
    // is seen before it is taken.
    const reopenedNow = reopenedKeys(turns);
    const reopenedThen = reopenedKeys(prev);
    const swapped = (k: string) =>
      (k.startsWith('you:') && reopenedNow.has(otherShape(k))) ||
      (k.startsWith('q:') && reopenedThen.has(k) && cur.has(otherShape(k)));
    gone.current = prev.map(turnKey).filter((k) => !cur.has(k) && !swapped(k));
    // An answer opened again: remember what it said, so its own words can say
    // whether anything actually changed when it closes.
    if (reopenedNow.size && !reopenedThen.size) {
      const answer = otherShape([...reopenedNow][0]);
      const before = prev.find((t) => turnKey(t) === answer);
      wasAnswer.current = before?.kind === 'you' ? { key: answer, text: before.text } : null;
    }
    // It closed on a different answer: whatever the conversation asks now is
    // being asked again, and is said again, even when it is the same question
    // that was standing all along, because what it was asked about has changed.
    if (reopenedThen.size > 0 && reopenedNow.size === 0) {
      const was = wasAnswer.current;
      wasAnswer.current = null;
      const now = was ? turns.find((t) => turnKey(t) === was.key) : undefined;
      const changedAnswer = !!was && (now?.kind !== 'you' || now.text !== was.text);
      const end = turns[turns.length - 1];
      askAgain.current = changedAnswer && end?.kind === 'question' ? turnKey(end) : null;
    }
    if (!reduced && gone.current.length) {
      const fresh = gone.current.some((k) => !fading?.gone.has(k));
      const kept = fading?.look && gone.current.includes(`q:${fading.look.qid}`) ? fading.look : null;
      const picked = look.current ?? kept;
      leave.current = {
        from: prev,
        gone: new Set(gone.current),
        look: picked,
        // a fade already running keeps its end; only a turn newly going starts one
        until: fresh ? now + (look.current ? PICK_MS : LEAVE_MS) : (fading?.until ?? now),
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
  // when each turn was first said, kept beside the said-lines for the same reason
  const times = useRef<Map<string, number> | null>(null);
  if (times.current === null) times.current = (memoryKey ? readTimes(memoryKey) : null) ?? new Map();
  // One clock, read by every time on screen, moved on a minute at a time so
  // "just now" stops saying so when it stops being true. It stands still once
  // nothing on screen is younger than an hour, because nothing it says would
  // change: past that, a time is a clock time and clock times do not move.
  const [clock, setClock] = useState(() => Date.now());
  const youngest = Math.max(0, ...times.current.values());
  const ticking = clock - youngest < 3_600_000;
  useEffect(() => {
    if (!ticking) return;
    const t = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [ticking]);
  if (askAgain.current) {
    seen.current.delete(askAgain.current);
    askAgain.current = null;
  }
  const fresh = new Set<string>();
  for (const t of list) {
    const k = turnKey(t);
    // An answer opened again is that answer, in its place: it is simply there,
    // and nothing types it out. It is not remembered as said either, because
    // it was never said: it is an answer being changed, and the question it
    // belongs to may well be asked again later, which is a line like any other.
    if (t.kind === 'question' && t.question.reopened) continue;
    if (seen.current.has(k)) continue;
    fresh.add(k);
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
      let at = due.current.get(k);
      if (at === undefined) {
        // the floor is kept between renders: a line that lands while an earlier
        // one is still being read waits for it, however many renders apart.
        // Your own words are yours, and a question you have already read and
        // answered is not being said to you again, so neither waits.
        const mine = t.kind === 'you' || (t.kind === 'scenri' && !!t.quiet);
        at = Math.max(now, mine ? 0 : free.current, leaving?.until ?? 0);
        due.current.set(k, at);
        free.current = Math.max(free.current, at + (mine ? ANSWER_MS : THINK_MS + REVEAL_LEAD_MS));
      }
      if (at <= now) shown.push(t);
      else soonest = Math.min(soonest, at - now);
    }
  }
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
      // a question open again is an editor, not a line that was said
      if (t.kind === 'question' && t.question.reopened) continue;
      const k = turnKey(t);
      if (!leaving?.gone.has(k)) set.add(k);
    }
    if (memoryKey) writeSaid(memoryKey, set);
    if (memoryKey && times.current) writeTimes(memoryKey, times.current);
  });

  /**
   * Which element is actually scrolling this, right now.
   *
   * It is not the same element at every width, and not the same one at every
   * moment: on a desktop the log scrolls itself, on a phone the studio column
   * does, and neither counts as a scroller until there is enough in it to
   * overflow. Resolved once and kept, and resolved again the moment the one we
   * are holding has stopped scrolling. Frozen at mount, this was read before
   * anything had arrived, came back as the log itself on a phone, and every
   * scroll after that was heard by nothing.
   */
  const scroller = useRef<HTMLElement | null>(null);
  const scrollingNow = useCallback((): HTMLElement | null => {
    const el = box.current;
    if (!el) return null;
    const held = scroller.current;
    if (held?.isConnected && held.scrollHeight > held.clientHeight) return held;
    scroller.current = scrollParent(el);
    return scroller.current;
  }, []);

  // The newest turn stays in view unless the reader scrolled up to read.
  useEffect(() => {
    // Heard on the way down rather than on one element: a scroll does not
    // bubble, so a listener on the wrong node hears nothing at all, and the
    // reader stayed pinned to the bottom however far up they had scrolled.
    const onScroll = () => {
      const parent = scrollingNow();
      if (parent) pinned.current = parent.scrollHeight - parent.scrollTop - parent.clientHeight < 24;
    };
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, [scrollingNow]);

  /**
   * The answer being changed: a question open again from it, or a sentence
   * being rewritten where it stands. One at a time, by construction.
   */
  const changing = (() => {
    const block = turns.find((t) => t.kind === 'question' && t.question.reopened);
    if (block) return turnKey(block);
    const said = turns.find((t) => t.kind === 'you' && t.editing);
    return said ? turnKey(said) : null;
  })();
  // The newest turn stays in view, except while an answer is being changed:
  // then the reader is with that answer, and the bottom is not the point.
  useLayoutEffect(() => {
    if (!pinned.current || changing) return;
    const parent = scrollingNow();
    if (parent) parent.scrollTop = parent.scrollHeight;
  });

  /**
   * An answer opened again is not somewhere else: the block takes the place
   * the answer held, under the line that asked for it, and grows downward
   * from there. Nothing is scrolled for it. The view moving as well as the
   * block appearing is the whole of what read as a jump, and the block was
   * always already on screen, because its own pencil was pressed.
   *
   * What does move is the keyboard: the pencil that was pressed is gone with
   * the answer, so the block takes the focus, and when the change is over the
   * answer's pencil takes it back. Without that the keyboard lands on nothing
   * and the reader loses the thread as surely as the eye would.
   */
  const focused = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (changing === focused.current) return;
    const was = focused.current;
    focused.current = changing;
    const el = box.current;
    if (!el) return;
    const here = document.activeElement;
    // the keyboard is only taken from the conversation itself, never from the
    // composer or from anything outside
    const ours = !here || here === document.body || el.contains(here);
    if (!ours) return;
    if (changing) {
      pinned.current = false;
      // a sentence rewritten in place already puts the caret in its field
      if (changing.startsWith('you:')) return;
      // the question as a group: its own controls carry tooltips, and one of
      // them taking the keyboard would put a label over the answer being changed
      turnNode(el, changing)?.querySelector<HTMLElement>('.sc-convo-q')?.focus({ preventScroll: true });
      return;
    }
    if (!was) return;
    // back to the pencil of the answer it became
    const answer = was.startsWith('q:') ? otherShape(was) : was;
    turnNode(el, answer)?.querySelector<HTMLElement>('.sc-convo-edit')?.focus({ preventScroll: true });
  });

  /**
   * A block that opened at the very bottom of the view has its own controls
   * under the fold. Once everything that was moving has settled, and only
   * then, it is brought up by the least that shows it: one movement, after
   * the others, rather than a second one competing with them.
   */
  useEffect(() => {
    if (!changing) return;
    const t = window.setTimeout(() => {
      const node = turnNode(box.current, changing);
      const parent = box.current && scrollParent(box.current);
      if (!node || !parent) return;
      const a = node.getBoundingClientRect();
      const b = parent.getBoundingClientRect();
      if (a.bottom - b.bottom > CUT_OFF) show(node, reduced);
    }, SLIDE_MS);
    return () => window.clearTimeout(t);
    // a delayed move has to outlive the renders between it and its moment: with
    // no dependencies the cleanup ran on every render and cancelled it
  }, [changing, reduced]);

  // A question that opens while the reader is somewhere else (an answer far
  // up was changed, and the conversation carries on from the bottom) is
  // brought into view by the shortest move that shows it, once, when it has
  // taken its place. Nothing else moves the reader.
  const openKey = turns.length && turns[turns.length - 1].kind === 'question' ? turnKey(turns[turns.length - 1]) : null;
  const followed = useRef<string | null>(openKey);
  // the question that stood open when an answer was opened again: back the
  // same, it is not new, and the reader stays with the answer they changed
  const beforeEdit = useRef<string | null>(null);
  useEffect(() => {
    if (openKey === followed.current) return;
    if (!openKey) {
      if (changing) beforeEdit.current = followed.current;
      followed.current = null;
      return;
    }
    const node = turnNode(box.current, openKey);
    if (!node) return;
    followed.current = openKey;
    const afterEdit = beforeEdit.current !== null;
    const same = beforeEdit.current === openKey;
    beforeEdit.current = null;
    if (pinned.current || (afterEdit && same)) return;
    // a question already on screen is not scrolled to
    const go = () => {
      if (!onScreen(node, box.current)) show(node, reduced);
    };
    if (!afterEdit) {
      go();
      return;
    }
    // after a change far up, the edited place stays a beat before the reader is
    // moved on; the wait outlives the renders in between, which a cleanup on
    // every render used to cancel
    const t = window.setTimeout(go, FOLLOW_MS);
    return () => window.clearTimeout(t);
  }, [openKey, changing, reduced]);

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
    const play = moved.current;
    moved.current = false;
    for (const node of el.querySelectorAll<HTMLElement>('.sc-convo-turn')) {
      const key = node.dataset.turn ?? '';
      const at = node.offsetTop;
      next.set(key, at);
      const was = spots.current.get(key);
      // a turn seen here for the first time plays its own arrival; everything
      // else the conversation moved is played back from where it was
      if (!play || reduced || was === undefined || Math.abs(was - at) < 1) continue;
      slide(node, was - at);
    }
    spots.current = next;
  });

  // While one answer is being changed, that exchange is the conversation: its
  // line and the thing being answered stand, and everything else steps back.
  // Nothing is disabled by it, because changing your mind twice is allowed;
  // the dim only says which answer the next tap belongs to.
  const bright = new Set<string>();
  if (changing) {
    bright.add(changing);
    // the line it was asked with stands with it
    const id = changing.slice(changing.indexOf(':') + 1);
    bright.add(`scenri:asked-${id}`);
  }

  // When each turn first stood on screen. A conversation is a record of when
  // things were said, so the times outlive a reload the way the said-lines do;
  // a turn that arrives while the page is settling from a draft takes the time
  // it was first seen, not the time the page opened.
  for (const t of shown) {
    const k = turnKey(t);
    if (!times.current.has(k)) times.current.set(k, Date.now());
  }

  let prevScenri = false;
  const out: ReactNode[] = [];
  for (const t of shown) {
    const k = turnKey(t);
    const dim = !!changing && !bright.has(k);
    const at = times.current.get(k);
    const going = !!leaving?.gone.has(k);
    // a block that was tapped goes as its ghost, not as a fade
    const ghost = going && t.kind === 'question' && leaving?.look?.qid === t.question.id;
    // A line already read as a question does not arrive again as its record.
    const quiet = t.kind === 'scenri' && !!t.quiet;
    const reveal = !reduced && !going && fresh.has(k) && !quiet;
    // a turn is put on screen when its beat comes, so it arrives from nothing
    // rather than waiting its turn invisibly at full height
    const delay = 0;
    const afterScenri = prevScenri;
    // a turn on its way out does not decide whether the next one carries the
    // eyebrow: it used to, so the line under a ghost grew by a whole row the
    // moment the ghost was taken away
    // a question open again stands where the answer stood, and the line after
    // it keeps the eyebrow it had: nothing around a change moves
    if (!going) prevScenri = t.kind === 'scenri' || (t.kind === 'question' && !t.question.reopened);
    if (t.kind === 'you') {
      out.push(
        <YouTurn
          key={k}
          text={t.text}
          photos={t.photos}
          editable={t.editable}
          editing={t.editing}
          arrive={reveal}
          leave={going}
          delay={delay}
          turnId={k}
          dim={dim}
          at={at}
          now={clock}
          onEdit={t.editable && onEdit ? () => onEdit(t.id) : undefined}
          onSave={onSaveEdit ? (said) => onSaveEdit(t.id, said) : undefined}
          onCancel={onCancelEdit}
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
          dim={dim}
          at={at}
          now={clock}
          thumb={t.thumb}
          label={t.label}
          current={t.current}
          restore={t.restore}
          onRestore={onRestore}
        />,
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
          dim={dim}
          // while one answer is being changed, no other question takes one
          busy={busy || dim}
          eyebrow={!afterScenri}
          at={at}
          now={clock}
          onAnswer={(a) => onAnswer(t.question.id, a)}
          onPick={onPick}
          onStarter={onStarter}
          onDescribe={onDescribe}
          onAttachFiles={onAttachFiles}
          onCancel={onCancelEdit}
        />,
      );
    }
  }
  return (
    <div
      ref={box}
      className="sc-convo-log"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      data-changing={changing ? 'true' : undefined}
    >
      <div className="sc-convo-turns">
        {out}
        {working && <Working what={working === true ? undefined : working} />}
      </div>
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

/** Is this turn's beginning inside the part of the conversation on screen? */
function onScreen(node: HTMLElement, box: HTMLElement | null): boolean {
  if (!box) return false;
  const parent = scrollParent(box);
  const a = node.getBoundingClientRect();
  const b = parent.getBoundingClientRect();
  return a.top >= b.top && a.top <= b.bottom - 24;
}

/** Bring a turn into view by the shortest move that shows it, where the platform can. */
function show(node: HTMLElement | null, reduced: boolean) {
  node?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
}

/**
 * The turn with this key, found by reading the keys rather than by building a
 * selector out of one: a turn key carries a colon, and escaping it needs a
 * `CSS.escape` that is not there in every environment the studio is rendered in.
 */
function turnNode(box: HTMLElement | null, key: string): HTMLElement | null {
  if (!box) return null;
  for (const node of box.querySelectorAll<HTMLElement>('.sc-convo-turn')) if (node.dataset.turn === key) return node;
  return null;
}

/** The questions open again from their answers, by key. */
function reopenedKeys(list: Turn[]): Set<string> {
  const out = new Set<string>();
  for (const t of list) if (t.kind === 'question' && t.question.reopened) out.add(turnKey(t));
  return out;
}

/** The same turn in its other shape: the answer's question, the question's answer. */
function otherShape(key: string): string {
  if (key.startsWith('you:')) return `q:${key.slice('you:'.length)}`;
  if (key.startsWith('q:')) return `you:${key.slice('q:'.length)}`;
  return '';
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
    sessionStorage.removeItem(timeKey(memoryKey));
  } catch {
    /* private mode */
  }
}

const timeKey = (memoryKey: string) => `scenri:convo-at:${memoryKey}`;

function readTimes(memoryKey: string): Map<string, number> | null {
  try {
    const raw = sessionStorage.getItem(timeKey(memoryKey));
    return raw ? new Map(Object.entries(JSON.parse(raw) as Record<string, number>)) : null;
  } catch {
    return null;
  }
}

function writeTimes(memoryKey: string, at: Map<string, number>) {
  try {
    sessionStorage.setItem(timeKey(memoryKey), JSON.stringify(Object.fromEntries(at)));
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
