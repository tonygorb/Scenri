import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowClockwise, PencilSimple, X } from '@phosphor-icons/react';
import { api } from '../../api.js';
import { useAppData } from '../../app/AppShell.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useTaskCenter } from '../../app/TaskCenter.js';
import { customScenesOf } from '../../brandAssets.js';
import { Confirm } from '../../Confirm.js';
import { loadAssetDraft } from '../../createDraft.js';
import { describeFailure } from '../../failure.js';
import type { AssetBuildFrame } from '../../apiTypes.js';
import { AssetCreateShell } from '../AssetCreateShell.js';
import { RefStrip } from '../RefStrip.js';
import { useAssetFields } from '../useAssetFields.js';
import { named, type FlowProps } from '../flow.js';
import { Board } from './Board.js';
import { ReviewSheet } from './ReviewSheet.js';
import { Stage } from './Stage.js';
import {
  MAX_UPLOADS,
  boardFrames,
  canAddView,
  canRemove,
  defaultCover,
  drawingFrame,
  drawnHashes,
  figureLed,
  frameLabel,
  landedFrames,
  primaryFor,
  resumeDecision,
  screenFor,
  seedFrame,
  statusLine,
} from './sceneBuildRules.js';
import { useSceneBuild } from './useSceneBuild.js';

/**
 * Building a place, one frame at a time.
 *
 * A scene is a world, not a picture, and a person cannot say yes to a world
 * from one form. So this flow shows them one: a direction, or a few images,
 * becomes a first frame; they say yes to it, or ask again, or adjust the
 * reading; the set then grows on a board, view by view, each drawn from the
 * same reading with the first frame beside it; they review the set, name it,
 * pick the card, save. The job runs on the server and survives a close: the
 * card on the Scenes wall reopens this.
 *
 * Nothing drawn here reaches a shot. A scene is words to a shot; the frames
 * are what the words were read from, and the card.
 */
export function SceneBuilder({
  onBack,
  onStarted,
  caps,
  capsNote,
  pendingState,
  restore,
  onDiscarded,
  build: buildParam,
}: FlowProps & { build?: string | null }) {
  const { brand } = useBrand();
  const { verticals } = useAppData();
  const { builds, poke } = useTaskCenter();
  const exists = useCallback((n: string) => named(customScenesOf(brand), n), [brand]);
  const f = useAssetFields(brand.id, 'scene', {
    max: MAX_UPLOADS,
    pendingState,
    exists,
    restore,
    onDiscarded,
    hydrateRunning: true,
  });
  const [jobId, setJobId] = useState<string | null>(
    () =>
      resumeDecision({
        param: buildParam ?? null,
        draftPending: loadAssetDraft(brand.id, 'scene')?.pending ?? null,
        live: builds,
      })?.attach ?? null,
  );
  const b = useSceneBuild(brand.id, jobId);
  const job = b.build && b.build !== 'gone' && b.build !== 'loading' ? b.build : null;
  const screen = screenFor(b.build);

  const [starting, setStarting] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [coverPick, setCoverPick] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [note, setNote] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [drawingSince, setDrawingSince] = useState<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(false);
  const busy = starting || b.busy !== null;

  // Focus follows the decision: Enter says yes to the world, then saves it.
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, [screen]);

  // The analyzer's name for the place, offered once; typing over it wins.
  const suggested = job?.suggestedName ?? null;
  useEffect(() => {
    if (suggested) setName((cur) => cur || suggested);
  }, [suggested]);

  // The frames this build drew and kept, into the draft, so a build the
  // server forgets can be picked up with them.
  const drawnKey = job ? drawnHashes(job).join(',') : null;
  const fieldsDrawnKey = f.fields.drawn.join(',');
  useEffect(() => {
    if (drawnKey === null || drawnKey === fieldsDrawnKey) return;
    f.set({ drawn: drawnKey ? drawnKey.split(',') : [] });
  }, [drawnKey, fieldsDrawnKey, f.set]);

  // The clock on a frame being drawn starts when it appears.
  const drawing = job ? drawingFrame(job) : null;
  const drawingKey = drawing ? `${drawing.purpose}:${drawing.attempt ?? 0}` : null;
  useEffect(() => {
    setDrawingSince(drawingKey ? new Date().toISOString() : null);
  }, [drawingKey]);

  // Review opens on the cover; elsewhere the stage shows what just landed.
  useEffect(() => {
    if (screen === 'reviewing' && job) setSelected(coverPick ?? defaultCover(job, f.fields.drawn));
    if (screen !== 'reviewing' && screen !== 'viewing') setSelected(null);
  }, [screen]);

  // Saved: the host closes, toasts, and tells whoever asked. Once.
  const stage = job?.stage ?? null;
  const assetId = job?.assetId ?? null;
  useEffect(() => {
    if (stage !== 'done' || !assetId || !job || doneRef.current) return;
    doneRef.current = true;
    f.submitted(null);
    onStarted({ kind: 'scene', jobId: job.id, id: assetId, name: job.name || name });
  }, [stage, assetId]);

  const start = async (hashes: string[], drawn?: string[]) => {
    setStarting(true);
    f.setErr(null);
    try {
      const { jobId: id } = await api.startAssetBuild(brand.id, {
        kind: 'scene',
        instruction: f.fields.instruction.trim() || undefined,
        imageHashes: hashes,
        facets: f.fields.facets,
        ...(drawn?.length ? { drawnHashes: drawn } : {}),
      });
      doneRef.current = false;
      f.submitted(id);
      setJobId(id);
      poke();
    } catch (e: any) {
      // A scene is already being built for this brand: that is the one to show.
      if (e?.status === 409) {
        const live = (await api.assetBuilds(brand.id).catch(() => ({ builds: [] }))).builds.find(
          (x) => x.kind === 'scene' && !x.finished,
        );
        if (live) {
          f.submitted(live.id);
          setJobId(live.id);
          poke();
          return;
        }
      }
      f.setErr(String(e?.message ?? e));
    } finally {
      setStarting(false);
    }
  };
  const begin = () => void start(f.fields.imageHashes);
  /** The approved frames go back in as images; the server reads them as a set. */
  const resume = () => void start([...f.fields.imageHashes, ...f.fields.drawn], f.fields.drawn);
  const startOver = () => {
    f.set({ drawn: [] });
    f.unsubmit();
    setJobId(null);
    setCoverPick(null);
    setName('');
    doneRef.current = false;
  };
  const stop = async () => {
    setConfirmStop(false);
    await b.cancel();
    startOver();
  };
  const save = () => {
    if (!job) return;
    void b.finish({
      name: name.trim(),
      cover: coverPick ?? selected ?? defaultCover(job, f.fields.drawn),
      facets: f.fields.facets,
    });
  };
  const sendAdjust = () => {
    const line = note.trim();
    if (!line || busy) return;
    setAdjusting(false);
    setNote('');
    void b.adjust(line);
  };

  const primary = primaryFor(screen, {
    typed: !!f.fields.instruction.trim(),
    uploads: f.fields.imageHashes.length,
    name,
    busy,
    canGenerate: caps?.canGenerate ?? true,
    build: job,
    drawn: f.fields.drawn.length,
  });
  const onPrimary = () => {
    if (screen === 'entry') begin();
    else if (screen === 'awaiting') void b.approve();
    else if (screen === 'reviewing') save();
    else if (screen === 'failed' || screen === 'gone') f.fields.drawn.length ? resume() : begin();
  };

  const submitOnMetaEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    if (primary.ready && !busy) onPrimary();
  };

  /* ---------------------------------------------------------- the board */
  const board: AssetBuildFrame[] = job
    ? boardFrames(job)
    : screen === 'gone' || screen === 'failed'
      ? f.fields.drawn.map((hash) => ({ hash, purpose: 'view', status: 'landed', origin: 'view' }))
      : [];
  const landed = job ? landedFrames(job) : [];
  const seed = job ? seedFrame(job) : null;
  const cover = job ? (coverPick ?? defaultCover(job, f.fields.drawn)) : null;
  const shown: string | null =
    screen === 'awaiting'
      ? (seed?.hash ?? null)
      : screen === 'viewing'
        ? (selected ?? landed[landed.length - 1]?.hash ?? null)
        : screen === 'reviewing'
          ? (selected ?? cover)
          : screen === 'seeding' || screen === 'saving'
            ? (landed[landed.length - 1]?.hash ?? null)
            : (board[board.length - 1]?.hash ?? null);
  const shownFrame = board.find((x) => x.hash === shown) ?? null;
  const shownLabel = shownFrame ? frameLabel(board, shownFrame) : 'First frame';
  const removable = job && shown ? canRemove(job, shown) : { ok: false, redraws: false };
  const figure = job ? figureLed(job) : false;

  /* ------------------------------------------------------ the verb rows */
  const secondary =
    screen === 'seeding' ? (
      <button
        type="button"
        className="sc-btn sc-btn-ghost"
        onClick={() => void stop()}
        disabled={busy && b.busy === 'cancel'}
      >
        Stop
      </button>
    ) : screen === 'awaiting' ? (
      <>
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          onClick={() => void b.retry()}
          aria-disabled={busy || undefined}
        >
          <ArrowClockwise size={12} /> Try again
        </button>
        {caps?.canAnalyze !== false && (
          <button
            type="button"
            className="sc-btn sc-btn-ghost"
            aria-pressed={adjusting}
            onClick={() => setAdjusting((v) => !v)}
            aria-disabled={busy || undefined}
          >
            <PencilSimple size={12} /> Adjust
          </button>
        )}
      </>
    ) : screen === 'viewing' || screen === 'reviewing' ? (
      <button type="button" className="sc-btn sc-btn-ghost" onClick={() => setConfirmStop(true)}>
        <X size={12} /> Stop building
      </button>
    ) : screen === 'failed' || screen === 'gone' ? (
      <button type="button" className="sc-btn sc-btn-ghost" onClick={startOver}>
        Start over
      </button>
    ) : null;

  const stageRow =
    screen === 'reviewing' && job && shown ? (
      <div className="sc-sb-row">
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          aria-pressed={shown === cover}
          onClick={() => setCoverPick(shown)}
          aria-disabled={busy || undefined}
        >
          Use as cover
        </button>
        {shownFrame?.origin === 'view' && (
          <button
            type="button"
            className="sc-btn sc-btn-ghost"
            aria-label={`Draw ${shownLabel.toLowerCase()} again`}
            onClick={() => void b.retry(shown)}
            aria-disabled={busy || undefined}
          >
            <ArrowClockwise size={12} /> Try again
          </button>
        )}
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          aria-label={`Remove ${shownLabel.toLowerCase()}`}
          title={removable.ok ? undefined : removable.why}
          aria-disabled={!removable.ok || busy || undefined}
          onClick={() => {
            if (!removable.ok || busy) return;
            if (coverPick === shown) setCoverPick(null);
            setSelected(null);
            void b.removeFrame(shown);
          }}
        >
          <X size={12} /> Remove
        </button>
      </div>
    ) : screen === 'viewing' && job && shownFrame?.origin === 'view' && shown ? (
      <div className="sc-sb-row">
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          aria-label={`Draw ${shownLabel.toLowerCase()} again`}
          onClick={() => void b.retry(shown)}
          aria-disabled={busy || undefined}
        >
          <ArrowClockwise size={12} /> Try again
        </button>
      </div>
    ) : null;

  const failure = screen === 'failed' && job?.stage === 'failed' ? describeFailure(job.error) : null;
  const error = f.err ?? b.err ?? failure?.title ?? null;

  return (
    <AssetCreateShell
      title={screen === 'entry' ? 'New scene' : name.trim() || suggested || 'New scene'}
      className="sc-scenebuilder"
      width="920px"
      error={error}
      footnote={
        screen === 'entry'
          ? capsNote(
              caps?.canGenerate
                ? 'One frame first. You decide before it draws more.'
                : 'No engine to draw with. Saved from your words and images.',
            )
          : undefined
      }
      primaryLabel={primary.label}
      ready={primary.ready}
      blocked={primary.blocked}
      busy={busy && screen !== 'seeding' && screen !== 'viewing'}
      primaryRef={primaryRef}
      secondary={secondary}
      onBack={screen === 'entry' ? onBack : undefined}
      onPrimary={onPrimary}
      onPasteFiles={screen === 'entry' ? (files) => void f.addFiles(files) : undefined}
    >
      <div className="sc-sb" data-screen={screen}>
        <div className="sc-sb-main">
          <Stage
            hash={shown}
            alt={`${shownLabel}${shown && shown === cover && screen === 'reviewing' ? ', cover' : ''}`}
            drawing={screen === 'seeding' || (screen === 'viewing' && !!drawing)}
            since={screen === 'seeding' ? (job?.stageAt?.seeding ?? job?.startedAt ?? drawingSince) : drawingSince}
            cover={!!shown && shown === cover && screen === 'reviewing'}
            status={statusLine(screen, job)}
          >
            {screen === 'entry' ? (
              <div className="sc-sb-well">
                <RefStrip
                  hashes={f.fields.imageHashes}
                  max={MAX_UPLOADS}
                  label="Add images"
                  hint={`Optional. Photos or screenshots of the place. Up to ${MAX_UPLOADS}.`}
                  busy={f.uploading}
                  onAdd={(files) => void f.addFiles(files)}
                  onRemove={f.removeHash}
                  onReject={() => f.setErr('Drop an image file.')}
                />
              </div>
            ) : undefined}
          </Stage>
          {stageRow}
          {adjusting && screen === 'awaiting' && (
            <div className="sc-sb-adjust sc-newdlg-secrow">
              <input
                className="sc-in"
                type="text"
                dir="auto"
                maxLength={400}
                placeholder="What to change, in one line"
                aria-label="Adjust"
                value={note}
                // biome-ignore lint/a11y/noAutofocus: the line opens on a press and takes the caret with it
                autoFocus
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    sendAdjust();
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    setAdjusting(false);
                  }
                }}
              />
              <button
                type="button"
                className="sc-btn sc-btn-ghost"
                onClick={sendAdjust}
                aria-disabled={!note.trim() || busy || undefined}
              >
                Go
              </button>
            </div>
          )}
          {screen !== 'entry' && (
            <Board
              frames={board}
              selected={shown}
              cover={screen === 'reviewing' ? cover : null}
              since={drawingSince}
              onSelect={setSelected}
              onRetry={screen === 'viewing' || screen === 'reviewing' ? (h) => void b.retry(h) : undefined}
            />
          )}
        </div>

        <div className="sc-sb-side">
          {screen === 'entry' && (
            <div className="sc-assetform-field">
              <label className="sc-newdlg-seclabel" htmlFor="sc-scene-direction">
                Direction
              </label>
              <textarea
                id="sc-scene-direction"
                className="sc-in"
                dir="auto"
                placeholder="Describe the world: place, materials, light, mood"
                rows={5}
                maxLength={400}
                value={f.fields.instruction}
                onChange={(e) => f.set({ instruction: e.target.value })}
                onKeyDown={submitOnMetaEnter}
              />
            </div>
          )}
          {(screen === 'seeding' || screen === 'awaiting' || screen === 'viewing' || screen === 'saving') &&
            job?.record && (
              <div className="sc-sb-reading">
                {job.record.lighting && <p className="sc-sb-note">{job.record.lighting}</p>}
                {job.record.description && <p className="sc-sb-note">{job.record.description}</p>}
                {job.coverage[0] && <p className="sc-sb-note">{job.coverage[0]}</p>}
              </div>
            )}
          {screen === 'reviewing' && job && (
            <ReviewSheet
              name={name}
              onName={setName}
              onSave={() => {
                if (primary.ready) save();
              }}
              verticals={verticals}
              facets={f.fields.facets}
              onToggleFacet={f.toggleFacet}
              figureLed={figure}
              addView={canAddView(job)}
              onAddView={() => void b.addView()}
              coverNote={job.coverage[0] ?? null}
            />
          )}
          {(screen === 'failed' || screen === 'gone') && (
            <p className="sc-sb-note">
              {screen === 'gone'
                ? f.fields.drawn.length
                  ? 'This build is gone. The frames you approved are still here, so it can go on from them.'
                  : 'This build is gone.'
                : job?.stage === 'cancelled'
                  ? 'Stopped.'
                  : (failure?.fix ?? failure?.title ?? 'The build failed.')}
            </p>
          )}
        </div>
      </div>
      <Confirm
        open={confirmStop}
        onOpenChange={setConfirmStop}
        label="Stop building"
        title="Stop building this scene?"
        body="The frames drawn so far are not saved."
        busy={b.busy === 'cancel'}
        onConfirm={() => void stop()}
      />
    </AssetCreateShell>
  );
}
