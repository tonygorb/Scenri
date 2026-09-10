import { FocusScope } from '@radix-ui/react-focus-scope';
import { X } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  type ComposerColour,
  ConversationComposer,
  type ComposerScope,
} from '../../conversation/ConversationComposer.js';
import type { Answer, Turn } from '../../conversation/question.js';
import { Transcript } from '../../conversation/Transcript.js';
import { Tip } from '../../layout/Tip.js';
import type { StripItem, Take, StudioView } from './presenterStudioRules.js';
import { StudioStage } from './StudioStage.js';

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
  items: StripItem[];
  onPick?: (view: StudioView) => void;
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
  /** The answer is a colour: the app's own chip carries it over the field. */
  colour?: ComposerColour | null;
  /** Stop what is drawing; only while something is. */
  onStop?: () => void;
}

/**
 * Everything the studio shell needs from a flow. Creation and editing are
 * different flows over the same surface: the stage, the rail with its head,
 * the transcript, the composer and the footnote.
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
  composer: ComposerSurface | null;
  text: string;
  onText: (next: string) => void;
  /** True when the sentence was taken. */
  onSend: (text: string) => boolean;
  onAnswer: (questionId: string, answer: Answer) => void;
  onEdit?: (turnId: string) => void;
  /** A tap question answered in words instead. */
  onDescribe?: () => void;
  /** An answer said again, where it stands. */
  onSaveEdit?: (turnId: string, text: string) => void;
  onCancelEdit?: () => void;
  onExpand?: () => void;
  /** A picture from before, put back on its view. */
  onRestore?: (view: string, hash: string) => void;
  /** The head's one quiet action: Start over, Discard changes. */
  headAction?: ReactNode;
  /** Rows above the composer: the filed-under line, a Keep previous offer. */
  dock?: ReactNode;
  footnote: ReactNode;
  /** Photographs pasted anywhere on the surface. */
  onPaste?: (files: File[]) => void;
  /** Dialogs the flow opens over the surface. */
  overlay?: ReactNode;
}

/**
 * The presenter studio's surface: a stage on the left and a rail on the
 * right, over the page it was opened from, the way the shot overlay stands
 * over the hub. Not a dialog: a person takes minutes and a draft outlives
 * the session, so the surface has an address and this only draws it.
 *
 * On a phone the same pieces stack: head, the stage held at the top, the
 * transcript scrolling under it, the composer at the bottom above the
 * keyboard.
 */
export function StudioShell({ surface, onClose }: { surface: StudioSurface; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Escape leaves, as it does the shot overlay, unless a popover or a Confirm
  // inside already took the key (Radix marks its Escape handled).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Enter decides the open question's first answer when no field has the
  // keyboard: Use this person, Save presenter, Retry, without reaching for
  // the mouse. A sentence in the composer keeps Enter for itself.
  const s = surface;
  const open = s.turns[s.turns.length - 1];
  const decide =
    open?.kind === 'question' && open.question.kind === 'confirm' && !open.question.quiet ? open.question : null;
  useEffect(() => {
    if (!decide || s.busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable))
        return;
      e.preventDefault();
      s.onAnswer(decide.id, { kind: 'confirm', id: decide.options[0].id });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide, s.busy, s.onAnswer]);

  return createPortal(
    <FocusScope
      trapped
      loop
      asChild
      onMountAutoFocus={(e) => {
        e.preventDefault();
        rootRef.current?.focus({ preventScroll: true });
      }}
    >
      <div
        ref={rootRef}
        tabIndex={-1}
        className="sc-pstudio"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-pstudio-title"
        onPaste={(e) => {
          if (!s.onPaste) return;
          const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (!files.length) return;
          e.preventDefault();
          s.onPaste(files);
        }}
      >
        {/* Before there is anything to look at, the phone gives the whole screen
            to the conversation: an empty plate is not worth a third of it. */}
        <div className="sc-pstudio-grid" data-phase={s.stage?.hash ? 'made' : 'setup'}>
          <Tip label="Close (esc)">
            <button type="button" className="sc-pstudio-close" onClick={onClose} aria-label="Close">
              <X size={13} />
            </button>
          </Tip>
          <div className="sc-pstudio-head sc-newdlg-head">
            <h2 id="sc-pstudio-title" className="sc-newdlg-title">
              {s.title}
            </h2>
            {s.headAction}
            <button type="button" className="sc-set-close sc-newdlg-close" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="sc-pstudio-scroll">
            {s.stage ? (
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
              />
            ) : (
              <div className="sc-pstudio-stage">
                <div className="sc-pstudio-wrap">
                  <div className="sc-pstudio-well" data-empty>
                    <span className="sc-pstudio-well-blank" aria-hidden>
                      The face comes first
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div className="sc-pstudio-body" data-convo>
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
                onExpand={s.onExpand}
                onRestore={s.onRestore}
                onStarter={(text) => s.onText(text)}
                onDescribe={s.onDescribe}
              />
            </div>
          </div>
          <div className="sc-pstudio-foot">
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
                colour={s.composer.colour}
                onStop={s.composer.onStop}
                onSend={s.onSend}
              />
            )}
            {s.footnote ? <p className="sc-dlg-foot">{s.footnote}</p> : null}
          </div>
        </div>
        {s.overlay}
      </div>
    </FocusScope>,
    document.body,
  );
}
