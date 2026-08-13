import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, type Scene } from '../api.js';
import { useAppData, useFilterParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { hubPath, scenePath, scenesPath, shotPath } from '../routes.js';
import { useApplyScene } from '../app/useApplyScene.js';
import { favoriteScenes, toggleFavoriteScene } from '../favorites.js';
import { SceneCard } from '../layout/SceneCard.js';
import { Star } from '@phosphor-icons/react';
import { EmptyRefFrame, RefFrame, ShotThumb, Slider } from '../layout/ReferenceGallery.js';
import { starredFirst } from '../layout/library/libraryRules.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { useMediaQuery } from '../useMediaQuery.js';

/** Matches `.sc-lookpage-refs` switching to 2 columns in tokens.css. */
/** Its own breakpoint, not the app's 767px phone: this one tracks the
 *  masonry's 760px column rule, so the cap and the columns can't disagree. */
const LOOKPAGE_PHONE = '(max-width: 760px)';

/**
 * One scene. The reference frames say what the light is; they are ours and are
 * deliberately not clickable. Everything below is yours: what you made with it,
 * and which scenes sit nearest by light.
 */
export function ScenePage() {
  const { sceneId = '' } = useParams();
  const { scenes, loaded, error, refetch } = useAppData();
  // one ask upstairs holds the whole brand now, so this page no longer walks
  // twenty project trees to answer "what did this scene actually produce"
  const { brand, nodes: shots } = useBrand();
  const navigate = useNavigate();
  const applyScene = useApplyScene();
  const brandId = brand.id;
  const [refs, setRefs] = useState<string[]>([]);
  const [favs, setFavs] = useState<string[]>(() => favoriteScenes(brandId));
  const [allParam, setOpenAll] = useFilterParam('all');
  const openAll = allParam === '1';
  // Cap tracks column count per breakpoint so collapsed rows stay full:
  // desktop 3-col → 3 cards; phone 2-col → 4 cards (2×2).
  const phone = useMediaQuery(LOOKPAGE_PHONE);
  const collapsedCap = phone ? 4 : 3;

  const openScene = (id: string) => navigate(scenePath(brand, id));

  const scene = scenes.find((s) => s.id === sceneId);

  // One ask for the whole set. Probing slot by slot filled the console with
  // 404s for every scene that has no set yet.
  useEffect(() => {
    let alive = true;
    setRefs([]);
    void api
      .sceneFrames(sceneId)
      .then((r) => {
        if (alive) setRefs(r.frames);
      })
      .catch(() => {
        if (alive) setRefs([]);
      });
    return () => {
      alive = false;
    };
  }, [sceneId]);

  /** Shots whose brief carried this scene, newest first. */
  const made = useMemo(
    () =>
      shots
        .filter(
          (s) =>
            s.status === 'done' &&
            s.images.length > 0 &&
            (s.brief?.tokens ?? []).some((t: any) => t?.t === 'template' && t.id === sceneId),
        )
        .slice(-12)
        .reverse(),
    [shots, sceneId],
  );

  const near = useMemo(() => {
    if (!scene) return [];
    const others = scenes.filter((s) => s.id !== scene.id);
    // nearest by light: same lighting phrase first, then the same collection
    return others.sort((a, b) => score(b) - score(a)).slice(0, 8);
    function score(s: Scene) {
      const sameLight = s.lighting
        .split(/[ ,]+/)
        .some((w) => w.length > 3 && scene!.lighting.toLowerCase().includes(w.toLowerCase()));
      const sameCollection = s.collections.some((c) => scene!.collections.includes(c));
      return (sameLight ? 2 : 0) + (sameCollection ? 1 : 0);
    }
  }, [scenes, scene]);

  /** Starred first, same ordering rule as Home's shelf and Create's FirstRun. */
  const recovery = useMemo(() => {
    if (scene || !loaded || error) return [];
    const favs = favoriteScenes(brandId);
    return starredFirst(scenes, (s) => favs.includes(s.id)).slice(0, 6);
  }, [scene, loaded, error, scenes, brandId]);

  if (!loaded) {
    return (
      <ScrollPane>
        <main className="sc-lookpage" id="main">
          <div className="sc-tplrow" aria-hidden />
        </main>
      </ScrollPane>
    );
  }

  if (error) {
    return (
      <ScrollPane>
        <main className="sc-lookpage" id="main">
          <h1>Couldn't load this scene</h1>
          <p className="sc-lookpage-lede">Something went wrong reaching the catalog.</p>
          <div className="sc-lookpage-acts">
            <button type="button" className="sc-btn sc-btn-primary" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        </main>
      </ScrollPane>
    );
  }

  if (!scene) {
    return (
      <ScrollPane>
        <main className="sc-lookpage" id="main">
          <h1>This scene isn't here anymore</h1>
          <p className="sc-lookpage-lede">It may have been removed from the catalog, or the link is out of date.</p>
          <div className="sc-lookpage-acts">
            <button
              type="button"
              className="sc-btn sc-btn-primary"
              onClick={() => navigate(`${hubPath(brand)}?compose=1`)}
            >
              Start from scratch
            </button>
            <button type="button" className="sc-btn sc-btn-ghost" onClick={() => navigate(scenesPath(brand))}>
              Browse all scenes
            </button>
          </div>
          {recovery.length > 0 && (
            <Slider label="You might like">
              {recovery.map((s) => (
                <SceneCard key={s.id} scene={s} variant="navigate" size="slider" onOpen={openScene} />
              ))}
            </Slider>
          )}
        </main>
      </ScrollPane>
    );
  }

  const visibleRefs = openAll ? refs : refs.slice(0, collapsedCap);
  const frames = refs.length ? visibleRefs : scene.previewUrl ? [scene.previewUrl] : [];
  // Product/either scenes ship their reference gallery shot with a demo
  // product standing in for the art direction — the caption says so, so
  // nobody mistakes it for part of the scene's recipe. Person-only scenes
  // never carry a demo product, so they skip it.
  const showDemoProductNote = scene.subject !== 'person' && frames.length > 0;

  const starred = favs.includes(scene.id);
  return (
    <ScrollPane>
      <main className="sc-lookpage" id="main">
        <div className="sc-lookpage-crumb">
          <button type="button" onClick={() => navigate(scenesPath(brand))}>
            Scenes
          </button>
          <span>/</span>
          <span>{scene.collections[0]}</span>
        </div>

        <h1>{scene.name}</h1>
        <p className="sc-lookpage-lede">{scene.description}</p>
        <p className="sc-lookpage-facts">
          {scene.lighting} · {scene.subject === 'either' ? 'product or person' : `for a ${scene.subject}`} ·{' '}
          {scene.width === scene.height ? 'square by default' : `${scene.width}×${scene.height} by default`}
        </p>
        <div className="sc-lookpage-acts">
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => void applyScene(scene.id)}>
            Use this scene
          </button>
          {/* Starred scenes get their own shelf on /scenes, and lead the one on Home. */}
          <button
            type="button"
            className="sc-btn sc-btn-ghost"
            aria-pressed={starred}
            onClick={() => setFavs(toggleFavoriteScene(brandId, scene.id))}
          >
            <Star size={13} weight={starred ? 'fill' : 'regular'} />
            <span>{starred ? 'Starred' : 'Star'}</span>
          </button>
        </div>

        {frames.length > 0 ? (
          <>
            <div className="sc-lookpage-refs">
              {frames.map((src) => (
                <RefFrame key={src} src={src} />
              ))}
            </div>
            {showDemoProductNote && (
              <p className="sc-lookpage-note">Shown with a demo product for reference — yours replaces it.</p>
            )}
            {refs.length > collapsedCap && (
              <button type="button" className="sc-lookpage-expand" onClick={() => setOpenAll(openAll ? null : '1')}>
                {openAll ? 'Enough, close it' : 'See the whole set'}
              </button>
            )}
          </>
        ) : (
          // a scene with no reference frame used to omit this whole section —
          // the same blank box a broken/missing image falls back to below,
          // rather than nothing where the scene's visual identity should be
          <EmptyRefFrame />
        )}

        {made.length > 0 && (
          <Slider label="Your shots in this scene">
            {made.map((s) => (
              <ShotThumb key={s.id} node={s} onClick={() => navigate(shotPath(brand, null, s.id))} />
            ))}
          </Slider>
        )}

        {near.length > 0 && (
          <Slider label="Other scenes, similar light">
            {near.map((s) => (
              <SceneCard key={s.id} scene={s} variant="navigate" size="slider" onOpen={openScene} />
            ))}
          </Slider>
        )}
      </main>
    </ScrollPane>
  );
}
