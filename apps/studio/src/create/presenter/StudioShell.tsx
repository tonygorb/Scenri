import { UserPlus } from '@phosphor-icons/react';
import { type ReactNode, useEffect } from 'react';
import {
  type ComposerColour,
  type ComposerRef,
  ConversationComposer,
  type ComposerScope,
} from '../../conversation/ConversationComposer.js';
import type { Answer, Turn } from '../../conversation/question.js';
import { Transcript } from '../../conversation/Transcript.js';
import { PHONE, useMediaQuery } from '../../useMediaQuery.js';
import { StageEmpty } from '../studio/StageEmpty.js';
import { StudioFrame } from '../studio/StudioFrame.js';
import { type StageStripItem, StudioStage } from '../studio/StudioStage.js';
import type { Take } from './presenterStudioRules.js';

/** The stage, as a flow describes it. */
export interface StageSurface {
  hash?: string;
  alt: string;
  drawing: boolean;
  since?: string;
  /** What is being drawn, in words, for the pill on the stage. */
  doing?: string;
  /** The pictures the view on the stage has worn, when it has worn more than one. */
  takes?: Take[];
  /** Put one of them back on the view. */
  onTake?: (hash: string) => void;
  /** The strip: a presenter's views, or a scene's place and its examples. */
  items: StageStripItem[];
  /** Method syntax on purpose: a flow picks by its own names (a presenter's views, a scene's roles). */
  onPick?(view: string): void;
  /** A candidate over a picture that stands: press to see the one it would replace. */
  compare?: { on: boolean; toggle: () => void };
}

/** The composer, as a flow describes it; null when the open question answers itself. */
export interface ComposerSurface {
  placeholder: string;
  label: string;
  action: string;
  scope?: ComposerScope | null;
  hint?: string | null;
  disabled?: boolean;
  working?: boolean;
  error?: string | null;
  why?: string | null;
  allowEmpty?: boolean;
  focusKey?: string;
  onAttach?: () => void;
  /** Or it opens the file chooser and hands the pictures over. */
  onAttachFiles?: (files: File[]) => void;
  /** What the attach button is for, in a few words. */
  attachLabel?: string;
  /** The answer is a colour: the app's own chip carries it over the field. */
  colour?: ComposerColour | null;
  /** Pictures riding with the answer, each as its own chip in the line. */
  refs?: ComposerRef[];
  /** Stop what is drawing; only while something is. */
  onStop?: () => void;
  /** That Stop is on its way. */
  stopping?: boolean;
}

/**
 * Everything the studio shell needs from a flow. Creation and editing are
 * different flows over the same surface: the stage, the rail with its head,
 * the transcript and the composer.
 */
export interface StudioSurface {
  title: string;
  turns: Turn[];
  busy: boolean;
  /** What is genuinely being waited for, for the line under Scenri's name. */
  working?: boolean | string;
  /** Where the transcript remembers what has been said. */
  memoryKey?: string;
  /** The page opened on a conversation that was already had. */
  resumed?: boolean;
  stage: StageSurface | null;
  /**
   * What the stage says while it has no picture yet.
   *
   * On the surface rather than on the stage, because the stage is null until
   * the draft exists and the words are wanted before that. A flow that leaves
   * it out gets the sign without words, which is right for a view standing in
   * a presenter who already has a face.
   */
  stageEmpty?: { lead: string; hint?: string };
  composer: ComposerSurface | null;
  text: string;
  onText: (next: string) => void;
  /** True when the sentence was taken. */
  onSend: (text: string) => boolean;
  onAnswer: (questionId: string, answer: Answer) => void;
  onEdit?: (turnId: string) => void;
  /** A tap question answered in words instead. */
  onDescribe?: () => void;
  /** A picture of the thing, chosen from the question itself. */
  onAttachRef?: (files: File[]) => void;

  /** A chip that starts a sentence rather than answering: it opens the composer on it. */
  onStarter?: (text: string) => void;
  /** An answer said again, where it stands. */
  onSaveEdit?: (turnId: string, text: string) => void;
  onCancelEdit?: () => void;
  /** A picture from before, put back on its view. */
  onRestore?: (view: string, hash: string) => void;
  /** A picture drawn again: a scene's example. */
  onRetry?: (view: string) => void;
  /** The head's one quiet action: Start over, Discard changes. */
  headAction?: ReactNode;
  /** Rows above the composer: the filed-under line, a Keep previous offer. */
  dock?: ReactNode;
  /** Photographs pasted anywhere on the surface. */
  onPaste?: (files: File[]) => void;
  /** Dialogs the flow opens over the surface. */
  overlay?: ReactNode;
  /** Which studio this is. A presenter's unless it says otherwise. */
  kind?: 'presenter' | 'scene';
  /** The empty stage's sign: a person for a presenter, a horizon for a scene. */
  glyph?: ReactNode;
}

/**
 * The presenter studio's surface: the shared studio frame with a conversation
 * in its rail. The frame owns the chrome (close, head, seam, phone); this owns
 * what the conversation needs from it: the transcript, the composer, and the
 * Enter that decides an open question.
 *
 * On a phone there is no stage: the head, the transcript scrolling, the
 * composer at the bottom above the keyboard, and the pictures in the
 * conversation itself.
 */
export function StudioShell({ surface, onClose }: { surface: StudioSurface; onClose: () => void }) {
  const phone = useMediaQuery(PHONE);

  // Enter decides the open question's first answer when no field has the
  // keyboard: Use this person, Save presenter, Retry, without reaching for
  // the mouse. A sentence in the composer keeps Enter for itself.
  const s = surface;
  // A picture in the conversation belongs to a view, and pressing it puts that
  // view on the stage. The stage's picker is the one that already does this
  // for the strip; the conversation only knows the view by name, so the two
  // are joined here rather than in either of them.
  const pick = s.stage?.onPick;
  const show = pick ? (view: string) => pick(view) : undefined;
  const open = s.turns[s.turns.length - 1];
  const decide =
    open?.kind === 'question' && open.question.kind === 'confirm' && !open.question.quiet ? open.question : null;
  useEffect(() => {
    if (!decide || s.busy) return;
    /**
     * One press answers one question.
     *
     * This path calls `onAnswer` directly rather than going through the
     * block's own control, so it never had the block's `picked` latch, and
     * `s.busy` is state that does not change inside a tick: two fast Enters on
     * a decision both fired, and Use sent two approvals. The effect re-runs
     * with each new question, so a question asked again gets its own press.
     */
    let answered = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.defaultPrevented || answered) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable))
        return;
      e.preventDefault();
      answered = true;
      s.onAnswer(decide.id, { kind: 'confirm', id: decide.options[0].id });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide, s.busy, s.onAnswer]);

  const glyph = s.glyph ?? <UserPlus size={32} />;
  /* No stage on a phone, in any phase. A screen this size cannot hold a
     gallery and a conversation at once: it took the top forty per cent and
     showed the same picture the log was already showing. Not rendered rather
     than hidden, so a phone does not fetch a full-size picture it will never
     put on screen. */
  const stage = phone ? null : s.stage ? (
    <StudioStage
      hash={s.stage.hash}
      alt={s.stage.alt}
      drawing={s.stage.drawing}
      since={s.stage.since}
      doing={s.stage.doing}
      takes={s.stage.takes}
      onTake={s.stage.onTake}
      items={s.stage.items}
      onPick={s.stage.onPick}
      compare={s.stage.compare}
      empty={s.stageEmpty}
      glyph={glyph}
    />
  ) : (
    /* The same stage, minus the strip, which has no views to show until the
       draft exists. `data-reserve` holds the height that strip will take, so
       the sign is in the same place before and after the draft lands rather
       than stepping up the screen. */
    <div className="sc-pstudio-stage" data-reserve>
      <div className="sc-pstudio-wrap">
        <div className="sc-pstudio-well" data-empty>
          <span className="sc-pstudio-well-blank">
            <StageEmpty glyph={glyph} lead={s.stageEmpty?.lead} hint={s.stageEmpty?.hint} />
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <StudioFrame
      kind={s.kind ?? 'presenter'}
      title={s.title}
      headAction={s.headAction}
      resizeLabel="Resize the conversation"
      onPaste={s.onPaste}
      onClose={onClose}
      overlay={s.overlay}
      stage={stage}
      bodyProps={{ 'data-convo': true }}
      body={
        <Transcript
          turns={s.turns}
          busy={s.busy}
          working={s.working}
          memoryKey={s.memoryKey}
          resumed={s.resumed}
          onAnswer={s.onAnswer}
          onEdit={s.onEdit}
          onSaveEdit={s.onSaveEdit}
          onCancelEdit={s.onCancelEdit}
          onRestore={s.onRestore}
          onRetry={s.onRetry}
          onShow={show}
          onStarter={(text) => (s.onStarter ?? s.onText)(text)}
          onDescribe={s.onDescribe}
          onAttachFiles={s.onAttachRef}
        />
      }
      foot={
        <>
          {s.dock}
          {s.composer && (
            <ConversationComposer
              quiet={!!s.composer.disabled && !s.composer.working}
              placeholder={s.composer.placeholder}
              label={s.composer.label}
              action={s.composer.action}
              scope={s.composer.scope}
              hint={s.composer.hint}
              value={s.text}
              onValue={s.onText}
              allowEmpty={s.composer.allowEmpty}
              disabled={s.composer.disabled}
              why={s.composer.why}
              working={s.composer.working}
              error={s.composer.error}
              focusKey={s.composer.focusKey}
              onAttach={s.composer.onAttach}
              onAttachFiles={s.composer.onAttachFiles}
              attachLabel={s.composer.attachLabel}
              colour={s.composer.colour}
              refs={s.composer.refs}
              onStop={s.composer.onStop}
              stopping={s.composer.stopping}
              onSend={s.onSend}
            />
          )}
        </>
      }
    />
  );
}
