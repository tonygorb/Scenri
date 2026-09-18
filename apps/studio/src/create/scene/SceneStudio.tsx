import { PencilSimple, SunHorizon } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { Brand } from '../../apiTypes.js';
import { Confirm } from '../../Confirm.js';
import { ConversationComposer } from '../../conversation/ConversationComposer.js';
import { PHONE, useMediaQuery } from '../../useMediaQuery.js';
import { StudioFrame } from '../studio/StudioFrame.js';
import { StudioStage } from '../studio/StudioStage.js';
import { COPY } from './sceneCopy.js';
import { ScenePictures } from './ScenePictures.js';
import {
  type Caps,
  current,
  doingLine,
  offerOf,
  phaseOf,
  picturesCaption,
  PLACE_MAX,
  primaryFor,
  shownReading,
  statusLine,
  type StudioState,
  takesOf,
} from './sceneStudioRules.js';
import { SceneWords } from './SceneWords.js';
import { type SavedScene, useSceneStudio } from './useSceneStudio.js';

/**
 * The scene studio: a direction desk beside a picture.
 *
 * A scene is a place and its light, told to every shot in words. So the rail
 * is not a conversation: the person says the place once, in words or pictures
 * or both, Scenri reads it back as the words a shot will be given, and one
 * picture is drawn from those words to prove them. Then there is one decision
 * (Use this scene, Try again) and one line for changing a single thing while
 * the rest stays. Nothing here is saved until Use.
 *
 * The same surface opens a saved scene for editing, seeded from its record
 * with nothing spent, so making and changing a scene are one experience.
 */
export function SceneStudio({
  brand,
  applyBrand,
  sceneId,
  seed,
  storageKey,
  caps,
  capsNote,
  onClose,
  onSaved,
}: {
  brand: Brand;
  applyBrand: (b: Brand) => void;
  /** Editing this saved scene; null for a new one. */
  sceneId: string | null;
  seed: StudioState | null;
  storageKey: string;
  caps: Caps | null;
  capsNote: (whenKnown: string) => ReactNode;
  onClose: () => void;
  onSaved: (made: SavedScene, how: 'created' | 'updated') => void;
}) {
  const phone = useMediaQuery(PHONE);
  const editing = !!sceneId;
  const f = useSceneStudio({
    brandId: brand.id,
    storageKey,
    seed,
    sceneId,
    caps,
    applyBrand,
    onSaved: (made, asNew) => onSaved(made, editing && !asNew ? 'updated' : 'created'),
  });
  const s = f.s;
  const phase = phaseOf(s);
  const v = current(s);
  const words = shownReading(s);
  const offer = offerOf(s);
  const primary = primaryFor(s, caps, f.uploading);
  const canDraw = caps?.canDraw ?? true;
  const working = phase === 'working';

  const [leaving, setLeaving] = useState(false);
  const [text, setText] = useState('');
  const [focusKey, setFocusKey] = useState<string | undefined>(undefined);
  // the place, rewritten after it was read: a local draft until Read again
  const [placeDraft, setPlaceDraft] = useState<string | null>(null);
  const decideRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    if (f.unsaved) {
      setLeaving(true);
      return;
    }
    f.leave();
    onClose();
  };

  // A version landed: the decision is the next thing to do, so the keyboard
  // goes to it, unless the person is typing somewhere.
  const landed = s.versions.length;
  useEffect(() => {
    if (!landed || s.job) return;
    const a = document.activeElement;
    if (!a || a === document.body || a.classList.contains('sc-pstudio'))
      decideRef.current?.focus({ preventScroll: true });
  }, [landed]);

  const read = (place?: string) => {
    setPlaceDraft(null);
    void f.start('make', place === undefined ? {} : { place });
  };

  /* ---- the stage */

  const showStage = !phone || phase !== 'writing' || !!v;
  // the picture standing, under the veil while its next version draws
  const stageHash = v?.hash ?? undefined;
  const takes = s.job ? undefined : takesOf(s);
  const stage = showStage ? (
    <StudioStage
      hash={stageHash}
      alt={`Preview of ${s.name.trim() || 'the scene'}${takes && takes.length > 1 ? `, version ${s.current + 1}` : ''}`}
      drawing={working}
      since={s.job?.since ?? undefined}
      doing={doingLine(s)}
      takes={takes}
      onTake={f.putBack}
      items={[]}
      empty={{ lead: COPY.emptyLead, hint: COPY.emptyHint }}
      glyph={<SunHorizon size={32} />}
    />
  ) : null;

  /* ---- the desk */

  const readYet = s.versions.length > 0;
  const placeLocked = working || f.saving;
  const body = (
    <div className="sc-sstudio-desk">
      {phone && !readYet && !working && <p className="sc-sstudio-intro">{COPY.phoneIntro}</p>}

      <section className="sc-sstudio-sec" aria-labelledby="sc-sstudio-place-lb">
        <h3 id="sc-sstudio-place-lb" className="sc-sstudio-lead">
          {readYet ? COPY.yourWords : COPY.placeLead}
        </h3>
        {!readYet || placeDraft !== null ? (
          <>
            <textarea
              className="sc-in sc-sstudio-place"
              dir="auto"
              rows={4}
              maxLength={PLACE_MAX}
              placeholder={COPY.placeholder}
              aria-labelledby="sc-sstudio-place-lb"
              aria-describedby="sc-sstudio-place-hint"
              disabled={placeLocked}
              value={placeDraft ?? s.place}
              onChange={(e) => (placeDraft !== null ? setPlaceDraft(e.target.value) : f.setPlace(e.target.value))}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
                e.preventDefault();
                if (placeDraft !== null) read(placeDraft);
                else if (!primary.blocked) read();
              }}
            />
            <p id="sc-sstudio-place-hint" className="sc-sstudio-hint">
              {COPY.placeHint}
            </p>
            {placeDraft !== null && (
              <div className="sc-sstudio-row">
                <button
                  type="button"
                  className="sc-btn sc-btn-primary"
                  disabled={placeLocked || (!placeDraft.trim() && !s.pictures.length)}
                  onClick={() => read(placeDraft)}
                >
                  {COPY.readAgain}
                </button>
                <button type="button" className="sc-btn sc-btn-ghost" onClick={() => setPlaceDraft(null)}>
                  {COPY.cancel}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="sc-sstudio-quote">
            <p dir="auto">{s.place.trim() || COPY.noWords}</p>
            {!placeLocked && (
              <button type="button" className="sc-btn sc-btn-ghost" onClick={() => setPlaceDraft(s.place)}>
                <PencilSimple size={13} />
                <span>{COPY.editWords}</span>
              </button>
            )}
          </div>
        )}
      </section>

      <ScenePictures
        hashes={s.pictures}
        uploads={f.uploads}
        disabled={placeLocked}
        caption={picturesCaption(words)}
        onAdd={(files) => void f.addFiles(files)}
        onRemove={f.removePicture}
        onReject={() => void f.addFiles([])}
      />

      {words && (
        <SceneWords
          reading={words}
          coverage={s.job ? s.job.coverage : (v?.coverage ?? [])}
          caption={v?.hash && !s.job ? (words.figure ? COPY.previewFigure : COPY.previewWords) : null}
          editable={!working && phase === 'review'}
          onEdit={f.editWords}
        />
      )}

      {words && (
        <label className="sc-sstudio-field">
          <span>{COPY.nameLabel}</span>
          <input
            className="sc-in"
            dir="auto"
            maxLength={60}
            placeholder={COPY.namePlaceholder}
            value={s.name}
            onChange={(e) => f.setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && offer.can) {
                e.preventDefault();
                void f.use();
              }
            }}
          />
        </label>
      )}

      {/* what Scenri says back, and what went wrong: read once, where it happened */}
      <p className="sc-sstudio-said" role="status" aria-live="polite">
        {f.offline ? 'Lost touch with Scenri. Still trying.' : s.job ? '' : (s.said ?? (s.error ? statusLine(s) : ''))}
      </p>
    </div>
  );

  /* ---- the foot */

  const useLabel = editing ? COPY.saveChanges : COPY.use;
  const decide = (
    <div className="sc-sstudio-decide">
      <button
        ref={decideRef}
        type="button"
        className="sc-btn sc-btn-primary"
        aria-disabled={!offer.can || f.saving || undefined}
        title={offer.why ?? undefined}
        data-busy={f.saving || undefined}
        onClick={() => {
          if (!offer.can || f.saving) return;
          void f.use();
        }}
      >
        {f.saving ? COPY.saving : useLabel}
      </button>
      {phase === 'review' && canDraw && v && (
        <button type="button" className="sc-btn sc-btn-ghost" onClick={() => void f.start('again')}>
          {v.hash ? COPY.again : COPY.drawPreview}
        </button>
      )}
      {phase === 'review' && (
        <button type="button" className="sc-btn sc-btn-ghost" onClick={() => setFocusKey(String(Date.now()))}>
          {COPY.change}
        </button>
      )}
      {phase === 'review' && editing && (
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          aria-disabled={!offer.can || f.saving || undefined}
          onClick={() => {
            if (!offer.can || f.saving) return;
            void f.use({ asNew: true });
          }}
        >
          {COPY.saveAsNew}
        </button>
      )}
    </div>
  );

  const foot =
    phase === 'writing' ? (
      <>
        <div className="sc-sstudio-decide">
          <button
            type="button"
            className="sc-btn sc-btn-primary"
            aria-disabled={!!primary.blocked || undefined}
            title={primary.blocked ?? undefined}
            onClick={() => !primary.blocked && read()}
          >
            {primary.label}
          </button>
        </div>
        <p className="sc-dlg-foot">
          {primary.blocked ??
            capsNote(canDraw ? 'One reading and one picture.' : 'Nothing here can draw, so it is saved as words.')}
        </p>
      </>
    ) : (
      <>
        {decide}
        <ConversationComposer
          quiet={working}
          placeholder={COPY.changePlaceholder}
          label={COPY.changeLabel}
          action={COPY.changeAction}
          value={text}
          onValue={(t) => {
            setText(t);
            if (s.said) f.clearSaid();
          }}
          disabled={working || !v}
          working={working}
          onStop={f.stop}
          why={working ? doingLine(s) : null}
          focusKey={focusKey}
          onSend={(t) => f.send(t)}
        />
      </>
    );

  return (
    <StudioFrame
      kind="scene"
      title={editing ? COPY.editTitle : COPY.title}
      resizeLabel={COPY.resize}
      onClose={close}
      onPaste={(files) => void f.addFiles(files)}
      onDropFiles={(files) => void f.addFiles(files)}
      stage={stage}
      bodyProps={{ 'data-desk': true, 'data-phase': phase }}
      body={body}
      foot={foot}
      overlay={
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
      }
    />
  );
}
