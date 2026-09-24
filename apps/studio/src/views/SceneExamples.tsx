import { Fragment, useState } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { api, type SceneExampleRole, type SceneView, thumbOf } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useApplyScene } from '../app/useApplyScene.js';
import { type CustomScene, coverViewOf } from '../brandAssets.js';
import { ImageLightbox } from '../composer/ImageLightbox.js';
import { FRAMINGS, SETUPS_MAX } from '../create/scene/sceneSetups.js';
import { Rail } from '../layout/Rail.js';
import { SceneViewActions, SceneViewCaption } from '../layout/SceneViewActions.js';
import { EmptyRefFrame, Shown } from '../layout/ReferenceGallery.js';
import { EXAMPLE_LABEL, type ExampleTile, earlierRoles, exampleTiles, examplesSubtitle } from '../sceneExampleRules.js';
import { useSceneExamples } from '../useSceneExamples.js';
import { useStillHere } from '../useStillHere.js';

/** The count in the button, so the cost is read before the press. */
const COUNT = ['no', 'one', 'two', 'three', 'four', 'five'];

/**
 * Your own scene's pictures: the place, then the place in use.
 *
 * The place is the picture a shot is given; the hero came with it from the
 * studio, and the rest are drawn with a Scenri demo product or presenter. Any
 * of them can be the one a shot follows (Use this view) or the one that stands
 * for the scene (Set as cover), and neither changes what the others are.
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
  const { job, first, again } = useSceneExamples(brandId, scene.id, scene.placeUrl ?? null);
  const [asking, setAsking] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [covering, setCovering] = useState(false);
  const [open, setOpen] = useState<Open | null>(null);

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

  /** One example drawn again from the place, from its menu: the same road, one role. */
  const redraw = async (role: SceneExampleRole) => {
    if (drawing || running) return;
    const here = stillHere();
    setDrawing(true);
    onError(null);
    try {
      await api.drawSceneExamples(brandId, scene.id, { roles: [role] });
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

  /** Show this view on the scene's card, in the pickers and on its chips. Presentation only. */
  const setCover = async (view: SceneView) => {
    const here = stillHere();
    setCovering(true);
    onError(null);
    try {
      const r = await api.updateScene(brandId, scene.id, { cover: view });
      applyBrand(r.brand);
    } catch (e: any) {
      if (here()) onError(String(e?.message ?? e));
    } finally {
      if (here()) setCovering(false);
    }
  };
  const coverView = coverViewOf(scene);
  /**
   * A view picked for one shot, to shoot like it: its frame, light and
   * treatment. The whole scene is a world a shot is new in; a picked view is
   * the frame it follows.
   */
  const shootLike = (hash: string | undefined, view: SceneView) =>
    hash ? () => applyScene(scene.id, undefined, hash, view) : undefined;

  // The hash only when it is the scene's own picture: the place falls back to
  // an upload, and an upload is never handed to a shot.
  const place: Open | null = scene.placeUrl
    ? {
        src: scene.placeUrl,
        label: 'The place',
        view: 'place',
        ...(scene.previewHash ? { hash: scene.previewHash } : {}),
      }
    : null;
  const sheet = (o: Open) => (
    <SceneViewActions
      variant="sheet"
      label={o.label}
      isCover={o.view === coverView}
      onUse={shootLike(o.hash, o.view)}
      onCover={() => void setCover(o.view)}
      onRedraw={
        o.view !== 'place' && !running
          ? () => {
              setOpen(null);
              void redraw(o.view as SceneExampleRole);
            }
          : undefined
      }
      busy={covering || drawing}
    />
  );
  // Saved before its picture was drawn: nothing to show yet.
  if (!tiles.length && !place) return <EmptyRefFrame />;
  // An older scene, or one nothing in the library suits: the place, alone and large.
  if (!tiles.length && place) {
    return (
      <>
        <div className="sc-scenepage-place sc-sceneview-frame">
          <button
            type="button"
            className="sc-scenepage-open"
            aria-label={`${place.label}, open`}
            onClick={() => setOpen(place)}
          >
            <Shown src={thumbOf(place.src, 'tile')} />
          </button>
          <SceneViewActions variant="tile" label={place.label} isCover onUse={shootLike(place.hash, 'place')} />
        </div>
        {offer}
        {open && (
          <ImageLightbox
            src={open.src}
            kind="scene"
            label={open.label}
            noun={scene.name}
            onClose={() => setOpen(null)}
            actions={sheet(open)}
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

  /**
   * The order is the roles', never the cover's: the hero first when there is
   * one (it is the scene at its best, and it came with the place), then the
   * place, then the rest of the set. Choosing a cover moves its mark, not the
   * pictures.
   */
  const heroFirst = tiles[0]?.role === 'hero';
  const placeTile = place ? (
    <li key="place">
      <span className="sc-sceneview-frame" data-cover={coverView === 'place' || undefined}>
        <button
          type="button"
          className="sc-refset-tile"
          aria-label={`The place${coverView === 'place' ? ', the cover' : ''}, open`}
          onClick={() => setOpen(place)}
        >
          <Shown src={thumbOf(place.src, 'small')} />
        </button>
        <SceneViewActions
          variant="tile"
          label={place.label}
          isCover={coverView === 'place'}
          onUse={shootLike(place.hash, 'place')}
          onCover={() => void setCover('place')}
          busy={covering}
        />
      </span>
      <SceneViewCaption label="The place" isCover={coverView === 'place'} />
    </li>
  ) : null;

  return (
    <>
      <Rail
        count={tiles.length + (place ? 1 : 0)}
        label="Pictures of this place"
        className="sc-refset-rail"
        trackClassName="sc-refset"
      >
        {!heroFirst && placeTile}
        {tiles.map((t, i) => {
          const label = EXAMPLE_LABEL[t.role];
          return (
            <Fragment key={t.role}>
              <li>
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
                  <span className="sc-sceneview-frame" data-cover={coverView === t.role || undefined}>
                    <button
                      type="button"
                      className="sc-refset-tile"
                      aria-label={`${label}${coverView === t.role ? ', the cover' : ''}, open`}
                      onClick={() =>
                        setOpen({
                          src: t.url as string,
                          label,
                          view: t.role,
                          tile: t,
                          ...(t.hash ? { hash: t.hash } : {}),
                        })
                      }
                    >
                      <Shown src={thumbOf(t.url as string, 'small')} />
                    </button>
                    <SceneViewActions
                      variant="tile"
                      label={label}
                      isCover={coverView === t.role}
                      onUse={shootLike(t.hash, t.role)}
                      onCover={() => void setCover(t.role)}
                      onRedraw={running ? undefined : () => void redraw(t.role)}
                      busy={covering || drawing}
                    />
                  </span>
                )}
                <SceneViewCaption label={label} isCover={coverView === t.role} />
              </li>
              {heroFirst && i === 0 && placeTile}
            </Fragment>
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
              <>
                {sheet(open)}
                <button
                  type="button"
                  className="sc-btn sc-btn-ghost"
                  disabled={asking}
                  onClick={() => void shootThisWay(way.id)}
                >
                  Shoot it this way
                </button>
              </>
            ) : (
              sheet(open)
            )
          }
        />
      )}
    </>
  );
}

/** A picture of this place opened full size, and what it is. */
type Open = { src: string; label: string; view: SceneView; tile?: ExampleTile; hash?: string };
