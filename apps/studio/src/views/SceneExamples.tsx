import { useState } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { api, thumbOf } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useApplyScene } from '../app/useApplyScene.js';
import type { CustomScene } from '../brandAssets.js';
import { ImageLightbox } from '../composer/ImageLightbox.js';
import { FRAMINGS, SETUPS_MAX } from '../create/scene/sceneSetups.js';
import { Rail } from '../layout/Rail.js';
import { EmptyRefFrame, Shown } from '../layout/ReferenceGallery.js';
import { EXAMPLE_LABEL, type ExampleTile, earlierRoles, exampleTiles, examplesSubtitle } from '../sceneExampleRules.js';
import { useSceneExamples } from '../useSceneExamples.js';
import { useStillHere } from '../useStillHere.js';

/** The count in the button, so the cost is read before the press. */
const COUNT = ['no', 'one', 'two', 'three', 'four', 'five'];

/**
 * Your own scene's pictures: the place, then the place in use.
 *
 * The place is the picture approved with Use this scene. The rest are drawn
 * with a Scenri demo product or presenter, and none of them reaches a shot: a
 * shot is told the scene's words. A picture here can only be shot this way,
 * which uses the scene rather than drawing anything.
 *
 * Nothing on this page draws by itself. One button asks for the place in use,
 * counted before it is pressed, and it is the only thing here that spends: a
 * scene saved in the studio with Not now, or saved before the set existed,
 * gets its set from here. Everything else reads (sceneExamples.ts).
 *
 * The rail is its final length from the moment a run starts: every example on
 * its way has a tile that shimmers until it lands.
 */
export function SceneExamples({
  brandId,
  scene,
  onError,
}: {
  brandId: string;
  scene: CustomScene;
  onError: (message: string | null) => void;
}) {
  const { applyBrand } = useAppData();
  const applyScene = useApplyScene();
  const stillHere = useStillHere();
  const { job, first, again } = useSceneExamples(brandId, scene.id, scene.previewUrl ?? null);
  const [asking, setAsking] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [open, setOpen] = useState<{ src: string; label: string; tile?: ExampleTile } | null>(null);

  const tiles = exampleTiles(scene.examples, job);
  const running = job?.status === 'running';
  const earlier = earlierRoles(scene.examples);

  /**
   * The one thing on this page that spends. What it draws is what the server
   * counted (`first`), so the button says it before it is pressed.
   */
  const drawInUse = async () => {
    if (drawing || !first.length) return;
    const here = stillHere();
    setDrawing(true);
    onError(null);
    try {
      await api.drawSceneExamples(brandId, scene.id, { first: true });
      again();
    } catch (e: any) {
      if (here()) onError(String(e?.message ?? e));
    } finally {
      if (here()) setDrawing(false);
    }
  };

  /** Asks for the place in use, saying what it costs. Hidden while a run draws. */
  const offer =
    first.length && job?.status !== 'running' ? (
      <p className="sc-scenepage-examples-ask">
        <button type="button" className="sc-btn sc-btn-ghost" disabled={drawing} onClick={() => void drawInUse()}>
          {earlier.length ? 'Draw them again' : 'Draw it in use'}
          {`, ${COUNT[first.length] ?? first.length} picture${first.length === 1 ? '' : 's'}`}
        </button>
      </p>
    ) : null;

  /** The way this example shows, kept on the scene if it is not yet, then used. */
  const shootThisWay = async (setup: string) => {
    const way = FRAMINGS.find((f) => f.id === setup);
    if (!way || asking) return;
    const here = stillHere();
    setAsking(true);
    onError(null);
    try {
      const ways = scene.setups ?? [];
      if (!ways.some((w) => w.id === way.id)) {
        const r = await api.updateScene(brandId, scene.id, { setups: [...ways, way] });
        applyBrand(r.brand);
      }
      applyScene(scene.id, way.id);
    } catch (e: any) {
      if (here()) onError(String(e?.message ?? e));
    } finally {
      if (here()) setAsking(false);
    }
  };

  const place = scene.previewUrl ? { src: scene.previewUrl, label: 'The place' } : null;
  // Saved before its picture was drawn: nothing to show yet.
  if (!tiles.length && !place) return <EmptyRefFrame />;
  // An older scene, or one nothing in the library suits: the place, alone and large.
  if (!tiles.length && place) {
    return (
      <>
        <div className="sc-scenepage-place">
          <button type="button" aria-label={`${place.label}, open`} onClick={() => setOpen(place)}>
            <Shown src={thumbOf(place.src, 'tile')} />
          </button>
        </div>
        {offer}
        {open && (
          <ImageLightbox
            src={open.src}
            kind="scene"
            label={open.label}
            noun={scene.name}
            onClose={() => setOpen(null)}
          />
        )}
      </>
    );
  }

  const tile = open?.tile;
  const way = tile?.setup ? FRAMINGS.find((f) => f.id === tile.setup) : undefined;
  const canShoot =
    !!way && ((scene.setups ?? []).some((w) => w.id === way.id) || (scene.setups ?? []).length < SETUPS_MAX);
  const state =
    running && job
      ? examplesSubtitle({
          status: job.status,
          step: job.current,
          done: job.done.length,
          total: job.roles.length,
          error: job.error,
        })
      : earlier.length > 0
        ? `${earlier.length === 1 ? `The ${EXAMPLE_LABEL[earlier[0]].toLowerCase()} shows` : 'These show'} an earlier picture of this place.`
        : null;

  return (
    <>
      <Rail
        count={tiles.length + (place ? 1 : 0)}
        label="Pictures of this place"
        className="sc-refset-rail"
        trackClassName="sc-refset"
      >
        {place && (
          <li>
            <button
              type="button"
              className="sc-refset-tile"
              aria-label="The place, open"
              onClick={() => setOpen(place)}
            >
              <Shown src={thumbOf(place.src, 'small')} />
            </button>
            <span className="sc-refset-lb" aria-hidden>
              The place
            </span>
          </li>
        )}
        {tiles.map((t) => {
          const label = EXAMPLE_LABEL[t.role];
          return (
            <li key={t.role}>
              {t.state === 'drawing' ? (
                <span className="sc-refset-tile" data-state="drawing" role="img" aria-label={`${label}, drawing`}>
                  {t.url && <Shown src={thumbOf(t.url, 'small')} />}
                  <span className="sc-shimmer" aria-hidden />
                </span>
              ) : t.state === 'failed' ? (
                <span
                  className="sc-refset-tile"
                  data-state="failed"
                  role="img"
                  aria-label={`${label} did not draw`}
                  title={t.error}
                >
                  <WarningCircle size={20} aria-hidden />
                  <span>Did not draw</span>
                </span>
              ) : (
                <button
                  type="button"
                  className="sc-refset-tile"
                  aria-label={`${label}, open`}
                  onClick={() => setOpen({ src: t.url as string, label, tile: t })}
                >
                  <Shown src={thumbOf(t.url as string, 'small')} />
                </button>
              )}
              <span className="sc-refset-lb" aria-hidden>
                {label}
              </span>
            </li>
          );
        })}
      </Rail>
      {state && (
        <p className="sc-scenepage-examples-state" aria-live="polite">
          {state}
        </p>
      )}
      {offer}

      {open && (
        <ImageLightbox
          src={open.src}
          kind="scene"
          label={open.label}
          noun={scene.name}
          onClose={() => setOpen(null)}
          actions={
            way && canShoot ? (
              <button
                type="button"
                className="sc-btn sc-btn-primary"
                disabled={asking}
                onClick={() => void shootThisWay(way.id)}
              >
                Shoot it this way
              </button>
            ) : undefined
          }
        />
      )}
    </>
  );
}
