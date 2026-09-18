import { type RefObject, useEffect, useRef, useState } from 'react';
import { CaretLeft, Check, X } from '@phosphor-icons/react';
import { useAppData, useDialogParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import type { GuideTaskId } from '../apiTypes.js';
import { thumbOf } from '../apiUploads.js';
import { useGuide } from '../guide.js';
import { useGuideFacts } from '../guideFacts.js';
import { firstShotMoment, presenterMoment } from '../guidedTasks.js';
import {
  LESSONS,
  NEEDS_SHOT,
  lessonOf,
  lessonState,
  pictureOf,
  stepOf,
  type Lesson,
  type LessonState,
} from '../lessons.js';
import { DialogSheet, SheetClose, SheetDescription, SheetTitle } from '../layout/DialogSheet.js';
import { useLaunchTask } from '../layout/useLaunchTask.js';

/** The library's own address: `?learn=lessons`. A lesson's is its id. */
export const ALL_LESSONS = 'lessons';

/**
 * Learn (DESIGN.md, "First use"): every lesson, then one lesson. A lesson is a
 * real thing to do in Scenri, and starting it closes this and hands over to
 * the tutor, which walks it where it happens. Nothing here is a tour or an
 * article: a picture of what the lesson makes, its steps as outcomes, and
 * whether it is new, in hand or done, all read from the install's record.
 *
 * It lives in the address like Settings (`?learn`, `?learn=<lesson>`), so the
 * bar's Learn button, Help and a pasted link are the same door. It opens over
 * the page you are on: the five destinations stay the five.
 */
export function LearnDialog() {
  const param = useDialogParam('learn');
  const open = param.value !== null;
  const lesson = lessonOf(param.value);
  const guide = useGuide();
  const facts = useGuideFacts();
  const data = useAppData();
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
  const art = {
    showcase: data.showcase,
    presenters: data.presenters,
    scenes: data.scenes,
    products: data.demoProducts,
  };
  const picture = (l: Lesson) => {
    const src = pictureOf(l.id, art);
    return src ? thumbOf(src, 'small') : null;
  };

  // The keyboard lands where the next press is: a lesson's own action on the
  // way in, the lesson just read on the way back.
  const actionRef = useRef<HTMLButtonElement>(null);
  const cards = useRef(new Map<GuideTaskId, HTMLButtonElement>());
  const lastRead = useRef<GuideTaskId | null>(null);
  useEffect(() => {
    if (!open) return;
    if (lesson) {
      lastRead.current = lesson.id;
      actionRef.current?.focus({ preventScroll: true });
    } else if (lastRead.current) cards.current.get(lastRead.current)?.focus({ preventScroll: true });
  }, [open, lesson]);

  return (
    <DialogSheet
      open={open}
      className="sc-learn"
      maxWidth="760px"
      described
      onDismiss={param.close}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {lesson ? (
        <LessonDetail
          key={lesson.id}
          lesson={lesson}
          state={stateOf(lesson)}
          at={stepNow(lesson)}
          picture={picture(lesson)}
          blocked={lesson.needs === 'shot' && !hasShot}
          actionRef={actionRef}
          onBack={() => param.set(ALL_LESSONS)}
          onBegin={() => begin(lesson.id)}
        />
      ) : (
        <div className="sc-learn-level" key="all">
          <div className="sc-newdlg-head">
            <SheetTitle className="sc-newdlg-title">Learn</SheetTitle>
            <CloseButton />
          </div>
          <SheetDescription className="sc-newdlg-sub">
            Each one walks you through one real thing in Scenri, a step at a time.
          </SheetDescription>
          <div className="sc-newdlg-body">
            <ul className="sc-learn-grid">
              {LESSONS.map((l) => {
                const state = stateOf(l);
                const src = picture(l);
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      className="sc-learn-card"
                      data-state={state}
                      ref={(el) => {
                        if (el) cards.current.set(l.id, el);
                        else cards.current.delete(l.id);
                      }}
                      onClick={() => param.set(l.id)}
                    >
                      <span className="sc-learn-pic">
                        {src && <img src={src} alt="" loading="lazy" decoding="async" />}
                      </span>
                      <span className="sc-learn-name">{l.title}</span>
                      <Meta lesson={l} state={state} at={stepNow(l)} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </DialogSheet>
  );
}

function LessonDetail({
  lesson,
  state,
  at,
  picture,
  blocked,
  actionRef,
  onBack,
  onBegin,
}: {
  lesson: Lesson;
  state: LessonState;
  at: number;
  picture: string | null;
  blocked: boolean;
  actionRef: RefObject<HTMLButtonElement>;
  onBack: () => void;
  onBegin: () => void;
}) {
  const label = blocked
    ? NEEDS_SHOT.action
    : state === 'active'
      ? 'Continue'
      : state === 'done'
        ? 'Do it again'
        : 'Start';
  // A step is done because the product said so: every step of a finished
  // lesson, the steps behind the one in hand, and none of a new one.
  const stepState = (i: number): 'done' | 'active' | 'todo' =>
    state === 'done' ? 'done' : state === 'active' ? (i < at ? 'done' : i === at ? 'active' : 'todo') : 'todo';
  return (
    <div className="sc-learn-level">
      <div className="sc-newdlg-head">
        <button type="button" className="sc-newdlg-back" onClick={onBack} aria-label="All lessons">
          <CaretLeft size={15} />
        </button>
        <SheetTitle className="sc-newdlg-title">{lesson.title}</SheetTitle>
        <CloseButton />
      </div>
      <div className="sc-newdlg-body">
        <div className="sc-learn-detail">
          <span className="sc-learn-pic">{picture && <img src={picture} alt="" decoding="async" />}</span>
          <div>
            <SheetDescription className="sc-learn-summary">{lesson.summary}</SheetDescription>
            <ol className="sc-learn-steps">
              {lesson.steps.map((step, i) => {
                const s = stepState(i);
                return (
                  <li
                    key={step}
                    className="sc-learn-step"
                    data-state={s}
                    aria-current={s === 'active' ? 'step' : undefined}
                  >
                    <span className="sc-learn-mark" aria-hidden="true">
                      {s === 'done' && <Check size={10} weight="bold" />}
                    </span>
                    {step}
                    {s === 'done' && <span className="sc-vh">, done</span>}
                  </li>
                );
              })}
            </ol>
            {blocked && <p className="sc-learn-note">{NEEDS_SHOT.note}</p>}
          </div>
        </div>
      </div>
      <div className="sc-newdlg-foot">
        <button
          ref={actionRef}
          type="button"
          className={state === 'done' && !blocked ? 'sc-btn' : 'sc-btn sc-btn-primary'}
          onClick={onBegin}
        >
          {label}
        </button>
      </div>
    </div>
  );
}

/** Where a lesson stands, in a few quiet words: never a percentage, never a colour. */
function Meta({ lesson, state, at }: { lesson: Lesson; state: LessonState; at: number }) {
  const n = lesson.steps.length;
  if (state === 'done')
    return (
      <span className="sc-learn-meta" data-state="done">
        <span className="sc-learn-tick" aria-hidden="true">
          <Check size={9} weight="bold" />
        </span>
        Done
      </span>
    );
  if (state === 'active')
    return (
      <span className="sc-learn-meta" data-state="active">
        Step {Math.min(at + 1, n)} of {n}
      </span>
    );
  return <span className="sc-learn-meta">{n} steps</span>;
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
