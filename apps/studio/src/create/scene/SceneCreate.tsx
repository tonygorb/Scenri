import { SunHorizon } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useState } from 'react';
import type { Brand } from '../../apiTypes.js';
import { Confirm } from '../../Confirm.js';
import { publishStudio } from '../../guideFacts.js';
import { StudioShell } from '../presenter/StudioShell.js';
import { COPY } from './sceneCopy.js';
import type { Caps, StudioState } from './sceneStudioRules.js';
import { useSceneFlow } from './useSceneFlow.js';
import type { SavedScene } from './useSceneStudio.js';

/**
 * The scene studio: the presenter's conversation, asking about a place.
 *
 * The same surface and the same pieces (the transcript that writes each line
 * out, questions answered by a tap or in words, a pencil that takes an answer
 * back, one composer that says what it is for), with a scene's own questions:
 * the pictures of a place, or where it is, its light, its feeling, what it is
 * made of, and whether it is built around someone. Scenri then reads the place
 * back as the words every shot will be told, and draws it on a press.
 *
 * A saved scene opens here too, at its record, with nothing spent.
 */
export function SceneCreate({
  brand,
  applyBrand,
  sceneId,
  seed,
  storageKey,
  caps,
  capsNote,
  onClose,
  onStartOver,
  onSaved,
}: {
  brand: Brand;
  applyBrand: (b: Brand) => void;
  sceneId: string | null;
  seed: StudioState | null;
  storageKey: string;
  caps: Caps | null;
  capsNote: (whenKnown: string) => ReactNode;
  onClose: () => void;
  /** A new conversation in place of this one. */
  onStartOver: () => void;
  onSaved: (made: SavedScene, how: 'created' | 'updated') => void;
}) {
  const f = useSceneFlow({ brand, applyBrand, sceneId, seed, storageKey, caps, onSaved });
  const [leaving, setLeaving] = useState(false);
  // The question on the floor, for the first-use guide (DESIGN.md, "First use").
  const last = f.turns[f.turns.length - 1];
  const open = last?.kind === 'question' ? last.question.id : null;
  useEffect(() => publishStudio({ open }), [open]);
  useEffect(() => () => publishStudio(null), []);
  const editing = !!sceneId;

  const close = () => {
    if (f.unsaved) {
      setLeaving(true);
      return;
    }
    f.leave();
    onClose();
  };

  const headAction =
    !editing && f.begun ? (
      <Confirm
        label={COPY.startOver}
        tone="quiet"
        title={COPY.startOverTitle}
        body={COPY.startOverBody}
        busy={false}
        onConfirm={() => {
          f.leave();
          onStartOver();
        }}
      />
    ) : null;

  return (
    <StudioShell
      onClose={close}
      surface={{
        kind: 'scene',
        glyph: <SunHorizon size={32} />,
        title: f.title,
        turns: f.turns,
        busy: f.busy,
        working: f.working,
        memoryKey: f.memoryKey,
        resumed: f.resumed,
        stage: f.stage,
        stageEmpty: { lead: COPY.emptyLead, hint: COPY.emptyHint },
        composer: f.composer,
        text: f.text,
        onText: f.onText,
        onSend: f.onSend,
        onAnswer: f.onAnswer,
        onEdit: f.onEdit,
        onSaveEdit: f.onSaveEdit,
        onCancelEdit: f.onCancelEdit,
        onRestore: f.onRestore,
        onDescribe: f.onDescribe,
        onStarter: f.onStarter,
        onPaste: f.onPaste,
        headAction,
        footnote: capsNote(f.canDraw ? COPY.footnote : COPY.footnoteBlind),
        overlay: (
          <Confirm
            label={editing ? COPY.discard : COPY.leave}
            title={editing ? COPY.discardTitle : COPY.leaveTitle}
            body={editing ? COPY.discardBody : COPY.leaveBody}
            busy={false}
            open={leaving}
            onOpenChange={(o) => {
              if (!o) setLeaving(false);
            }}
            onConfirm={() => {
              setLeaving(false);
              f.leave();
              onClose();
            }}
          />
        ),
      }}
    />
  );
}
