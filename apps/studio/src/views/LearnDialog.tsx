import { type RefObject, useEffect, useRef, useState } from 'react';
import { ArrowRight, CaretLeft, Check, X } from '@phosphor-icons/react';
import { useDialogParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import type { GuideTaskId } from '../apiTypes.js';
import { useGuide } from '../guide.js';
import { useGuideFacts } from '../guideFacts.js';
import { firstShotMoment, presenterMoment } from '../guidedTasks.js';
import {
  LESSON_PICTURES,
  LESSONS,
  NEEDS_SHOT,
  lessonOf,
  lessonState,
  stepOf,
  type Lesson,
  type LessonState,
} from '../lessons.js';
import { DialogSheet, SheetClose, SheetDescription, SheetTitle } from '../layout/DialogSheet.js';
import { useLaunchTask } from '../layout/useLaunchTask.js';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';

/** The library's own address: `?learn=lessons`. A lesson's is its id. */
export const ALL_LESSONS = 'lessons';

/**
 * Learn (DESIGN.md, "First use"): every lesson beside the one being read. A
 * lesson is a real thing to do in Scenri, and starting it closes this and
 * hands over to the tutor, which walks it where it happens. Nothing here is a
 * tour or an article: a picture of the lesson, its steps as outcomes, and
 * whether it is new, in hand or done, all read from the install's record.
 *
 * On a desktop it is one level: the five on the left, the chosen one open on
 * the right, and nothing moves when another is chosen. A phone has room for
 * one at a time, so the list comes first and a lesson opens over it.
 *
 * It lives in the address like Settings (`?learn`, `?learn=<lesson>`), so the
 * bar's Learn button, Help and a pasted link are the same door. It opens over
 * the page you are on: the five destinations stay the five.
 */
export function LearnDialog() {
  const param = useDialogParam('learn');
  const open = param.value !== null;
  const chosen = lessonOf(param.value);
  const phone = useMediaQuery(PHONE);
  const guide = useGuide();
  const facts = useGuideFacts();
  const { brand, recent } = useBrand();
  const { builds } = useTaskCenter();
  const launch = useLaunchTask();

  // A lesson begins once this has closed: opening its surface in the same
  // moment would write the address this is still leaving.
  const [pending, setPending] = useState<GuideTaskId | null>(null);
  useEffect(() => {
    if (open || !pending) return;
    setPending(null);
    void launch(pending);
  }, [open, pending, launch]);
  const began = useRef(false);
  const begin = (id: GuideTaskId) => {
    began.current = true;
    setPending(id);
    param.close();
  };
  // Closed without beginning anything, the keyboard goes back where it came
  // from: the bar's Learn button, or Help where the bar has none (below 1024px).
  const onCloseAutoFocus = () => {
    const leaving = began.current;
    began.current = false;
    if (leaving) return;
    requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      (
        document.querySelector<HTMLElement>('.sc-learn-btn') ?? document.querySelector<HTMLElement>('.sc-help-btn')
      )?.focus();
    });
  };

  const hasShot = recent.some((n) => n.kind !== 'root' && n.status === 'done' && n.images.length > 0);
  /** Refining needs a shot to refine: until there is one, the lesson cannot begin. */
  const blockedOf = (l: Lesson) => l.needs === 'shot' && !hasShot;
  const stateOf = (l: Lesson): LessonState => lessonState(l.id, guide, brand.id);
  const stepNow = (l: Lesson): number => {
    const composer = facts.composer?.brandId === brand.id ? facts.composer : null;
    const moment =
      l.id === 'first-shot'
        ? (firstShotMoment({ here: true, composer, nodes: guide.activeNodes, begun: true })?.id ?? null)
        : l.id === 'presenter'
          ? (presenterMoment(facts.studio)?.id ?? null)
          : null;
    return stepOf(l.id, {
      moment,
      nodes: guide.activeNodes,
      draft: !!guide.activeDraftId,
      building: l.id === 'scene' && builds.some((b) => b.kind === 'scene' && !b.finished),
    });
  };
  // The lesson that comes next: the one in hand, else the first not yet done.
  const next = LESSONS.find((l) => stateOf(l) === 'active') ?? LESSONS.find((l) => stateOf(l) !== 'done') ?? null;
  // What a desktop shows open: the lesson asked for, else the one that comes next.
  const shown = chosen ?? next ?? LESSONS[0];
  const done = LESSONS.filter((l) => stateOf(l) === 'done').length;

  // The pictures are the app's own files, so warming them once Learn is open
  // means choosing another lesson shows a picture that is already decoded
  // rather than an empty box for a frame.
  useEffect(() => {
    if (!open) return;
    for (const p of Object.values(LESSON_PICTURES)) new Image().src = p.wide;
  }, [open]);

  // The keyboard lands where the next press is: the lesson's one action as it
  // opens, and on a phone the row just read on the way back to the list.
  const actionRef = useRef<HTMLButtonElement>(null);
  const rows = useRef(new Map<GuideTaskId, HTMLButtonElement>());
  const lastRead = useRef<GuideTaskId | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!open) return;
    if (phone && chosen) {
      lastRead.current = chosen.id;
      actionRef.current?.focus({ preventScroll: true });
    } else if (phone && lastRead.current) rows.current.get(lastRead.current)?.focus({ preventScroll: true });
    else if (opening) actionRef.current?.focus({ preventScroll: true });
  }, [open, phone, chosen]);

  // No key: choosing another lesson swaps the words and the picture in the
  // same elements. Remounting restarted their entrance animation, which read
  // as a flash on every click.
  const lessonView = (l: Lesson, describe: boolean) => (
    <LessonView
      lesson={l}
      state={stateOf(l)}
      at={stepNow(l)}
      blocked={blockedOf(l)}
      describe={describe}
      actionRef={actionRef}
      onBegin={() => begin(l.id)}
    />
  );

  return (
    <DialogSheet
      open={open}
      className="sc-learn"
      maxWidth="880px"
      described
      onDismiss={param.close}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {phone && chosen ? (
        <div className="sc-learn-level" key={`one-${chosen.id}`}>
          <div className="sc-newdlg-head">
            <button
              type="button"
              className="sc-newdlg-back"
              onClick={() => param.set(ALL_LESSONS)}
              aria-label="All lessons"
            >
              <CaretLeft size={15} />
            </button>
            <SheetTitle className="sc-newdlg-title">{chosen.title}</SheetTitle>
            <CloseButton />
          </div>
          <div className="sc-newdlg-body sc-learn-body">{lessonView(chosen, true)}</div>
        </div>
      ) : (
        <div className="sc-learn-level" key="all">
          <div className="sc-newdlg-head">
            <SheetTitle className="sc-newdlg-title">Learn</SheetTitle>
            <span className="sc-learn-count">
              {done} of {LESSONS.length} done
            </span>
            <CloseButton />
          </div>
          {/* The header is the title, where they are, and the way out. What
              this place is for is said by the lessons themselves, so the line
              stays for a screen reader and takes no room on the screen. */}
          <SheetDescription className="sc-vh">
            Each one walks you through one real thing, a step at a time.
          </SheetDescription>
          <div className="sc-newdlg-body sc-learn-body">
            <ul className="sc-learn-list">
              {LESSONS.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    className="sc-learn-row"
                    data-state={stateOf(l)}
                    aria-current={!phone && shown.id === l.id ? 'true' : undefined}
                    ref={(el) => {
                      if (el) rows.current.set(l.id, el);
                      else rows.current.delete(l.id);
                    }}
                    onClick={() => param.set(l.id)}
                  >
                    <span className="sc-learn-thumb">
                      <img src={LESSON_PICTURES[l.id].square} alt="" decoding="async" />
                    </span>
                    <span className="sc-learn-say">
                      <span className="sc-learn-name">{l.title}</span>
                      <Status lesson={l} state={stateOf(l)} at={stepNow(l)} blocked={blockedOf(l)} />
                    </span>
                    {next?.id === l.id && <span className="sc-learn-next">Next</span>}
                  </button>
                </li>
              ))}
            </ul>
            {!phone && lessonView(shown, false)}
          </div>
        </div>
      )}
    </DialogSheet>
  );
}

/**
 * One lesson: its picture, its words, and its steps as the action. Only the
 * step in hand can be pressed, carrying the word for it; a step behind it is
 * done and one ahead cannot be reached yet, so neither pretends to be a button.
 */
function LessonView({
  lesson,
  state,
  at,
  blocked,
  describe,
  actionRef,
  onBegin,
}: {
  lesson: Lesson;
  state: LessonState;
  at: number;
  blocked: boolean;
  describe: boolean;
  actionRef: RefObject<HTMLButtonElement>;
  onBegin: () => void;
}) {
  const verb = blocked
    ? NEEDS_SHOT.action
    : state === 'active'
      ? 'Continue'
      : state === 'done'
        ? 'Start again'
        : 'Start';
  // The step with the action: the one in hand, or the first of a lesson that
  // is new or already done.
  const inHand = state === 'active' ? at : 0;
  // A step is done because the product said so: every step of a finished
  // lesson and the steps behind the one in hand. A new lesson's first step is
  // the one it starts on.
  const stepState = (i: number): 'done' | 'active' | 'todo' =>
    state === 'done'
      ? 'done'
      : state === 'active'
        ? i < at
          ? 'done'
          : i === at
            ? 'active'
            : 'todo'
        : i === 0
          ? 'active'
          : 'todo';
  const summary = describe ? (
    <SheetDescription className="sc-learn-summary">{lesson.summary}</SheetDescription>
  ) : (
    <p className="sc-learn-summary">{lesson.summary}</p>
  );
  return (
    <section className="sc-learn-lesson" aria-label={lesson.title}>
      <span className="sc-learn-hero">
        <img src={LESSON_PICTURES[lesson.id].wide} alt="" decoding="async" />
      </span>
      <div className="sc-learn-copy">
        <div className="sc-learn-kicker">
          <Status lesson={lesson} state={state} at={at} blocked={blocked} />
        </div>
        <h3 className="sc-learn-title">{lesson.title}</h3>
        {summary}
        {/* Steps and whatever has to be said under them share one reserved
            block, so a lesson that needs a note is no taller than one that
            does not and the box holds still. */}
        <div className="sc-learn-do">
          <ol className="sc-learn-steps">
            {lesson.steps.map((step, i) => {
              const s = stepState(i);
              const mark = (
                <span className="sc-learn-n" aria-hidden="true">
                  {s === 'done' ? <Check size={14} weight="bold" /> : i + 1}
                </span>
              );
              const current = state === 'active' && i === at ? 'step' : undefined;
              return (
                <li key={step}>
                  {i === inHand ? (
                    <button
                      ref={actionRef}
                      type="button"
                      className="sc-learn-step"
                      data-state={s}
                      data-here=""
                      aria-current={current}
                      aria-label={`${verb}: ${step}`}
                      onClick={onBegin}
                    >
                      {mark}
                      <span className="sc-learn-step-name">{step}</span>
                      <span className="sc-learn-go" aria-hidden="true">
                        {verb} <ArrowRight size={12} weight="bold" />
                      </span>
                    </button>
                  ) : (
                    <div className="sc-learn-step" data-state={s} aria-current={current}>
                      {mark}
                      <span className="sc-learn-step-name">{step}</span>
                      {s === 'done' && <span className="sc-vh">, done</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {blocked && <p className="sc-learn-note">{NEEDS_SHOT.note}</p>}
        </div>
      </div>
    </section>
  );
}

/** Where a lesson stands, in a few quiet words: done in green, never a percentage. */
function Status({ lesson, state, at, blocked }: { lesson: Lesson; state: LessonState; at: number; blocked?: boolean }) {
  const n = lesson.steps.length;
  if (state === 'done')
    return (
      <span className="sc-learn-status" data-state="done">
        <span className="sc-learn-tick" aria-hidden="true">
          <Check size={9} weight="bold" />
        </span>
        Done
      </span>
    );
  if (state === 'active')
    return (
      <span className="sc-learn-status" data-state="active">
        Step {Math.min(at + 1, n)} of {n}
      </span>
    );
  // why its action reads differently: it cannot begin until there is a shot
  if (blocked) return <span className="sc-learn-status">Needs a shot</span>;
  return <span className="sc-learn-status">{n} steps</span>;
}

function CloseButton() {
  return (
    <SheetClose>
      <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
        <X size={16} />
      </button>
    </SheetClose>
  );
}
