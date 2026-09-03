import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Spinner, TextArea, TextField } from '@radix-ui/themes';
import { api, type Scene, type ScenePatch } from '../api.js';
import { useAppData, useFilterParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useMadeWith } from './useMadeWith.js';
import { useTitleEntity } from '../useDocumentTitle.js';
import { customSceneById } from '../brandAssets.js';
import { hubPath, scenePath, scenesPath, shotPath } from '../routes.js';
import { useApplyScene } from '../app/useApplyScene.js';
import { bookmarkedScenes, toggleBookmarkScene } from '../bookmarks.js';
import { Confirm } from '../Confirm.js';
import { SceneCard } from '../layout/SceneCard.js';
import { ArrowClockwise, BookmarkSimple, Eye } from '@phosphor-icons/react';
import { EmptyRefFrame, RefFrame, ShotThumb, Slider } from '../layout/ReferenceGallery.js';
import { bookmarkedFirst } from '../layout/library/libraryRules.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { useMediaQuery } from '../useMediaQuery.js';

/** Matches `.sc-lookpage-refs` switching to 2 columns in app.css. */
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
  const { scenes, loaded, error, refetch, applyBrand } = useAppData();
  // one ask upstairs holds the whole brand now, so this page no longer walks
  // twenty project trees to answer "what did this scene actually produce"
  const { brand } = useBrand();
  const navigate = useNavigate();
  const applyScene = useApplyScene();
  const brandId = brand.id;
  const [refs, setRefs] = useState<string[]>([]);
  const [marks, setMarks] = useState<string[]>(() => bookmarkedScenes(brandId));
  const [allParam, setOpenAll] = useFilterParam('all');
  const openAll = allParam === '1';
  // Cap tracks column count per breakpoint so collapsed rows stay full:
  // desktop 3-col → 3 cards; phone 2-col → 4 cards (2×2).
  const phone = useMediaQuery(LOOKPAGE_PHONE);
  const collapsedCap = phone ? 4 : 3;

  const openScene = (id: string) => navigate(scenePath(brand, id));

  // The brand's own places come before the catalog, the same order the
  // compiler resolves them in.
  const owned = customSceneById(brand, sceneId);
  const scene = owned ?? scenes.find((s) => s.id === sceneId);
  useTitleEntity(scene?.name);

  // One ask for the whole set. Probing slot by slot filled the console with
  // 404s for every scene that has no set yet.
  //
  // The boolean, never `owned` itself: the adapter builds a fresh object every
  // render, and an effect keyed on that identity re-runs on every commit. With
  // setRefs inside, that was a silent infinite commit loop that starved every
  // router transition — the page painted, then nothing in the app responded.
  const isOwned = !!owned;
  useEffect(() => {
    let alive = true;
    setRefs([]);
    // A scene built here carries its own images; only a curated one has a
    // reference set sitting on disk to go and ask about.
    if (isOwned) return;
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
  }, [sceneId, isOwned]);

  /** Shots whose brief carried this scene, newest first. */
  const made = useMadeWith(brand.id, [sceneId ?? '']);

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

  /** Bookmarked first, the same ordering rule as Home's scene shelf. */
  const recovery = useMemo(() => {
    if (scene || !loaded || error) return [];
    const marks = bookmarkedScenes(brandId);
    return bookmarkedFirst(scenes, (s) => marks.includes(s.id)).slice(0, 6);
  }, [scene, loaded, error, scenes, brandId]);

  const [draftName, setDraftName] = useState(owned?.name ?? '');
  const [draftDescription, setDraftDescription] = useState(owned?.description ?? '');
  const [draftLighting, setDraftLighting] = useState(owned?.lighting ?? '');
  const [draftPrompt, setDraftPrompt] = useState(owned?.prompt ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [rereading, setRereading] = useState(false);
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // Resync only on a different scene, so a refresh landing mid-keystroke
    // cannot overwrite what is being typed.
    setDraftName(owned?.name ?? '');
    setDraftDescription(owned?.description ?? '');
    setDraftLighting(owned?.lighting ?? '');
    setDraftPrompt(owned?.prompt ?? '');
  }, [owned?.id]);

  /** Editing a scene is a plain write. Only the preview costs a generation. */
  const patch = (next: ScenePatch) => {
    if (!owned) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api
        .updateScene(brand.id, owned.id, next)
        .then((r) => {
          applyBrand(r.brand);
          setErr(r.warnings[0] ?? null);
        })
        .catch((e: any) => setErr(String(e.message ?? e)));
    }, 500);
  };

  const redrawPreview = async () => {
    if (!owned) return;
    setDrawing(true);
    setErr(null);
    try {
      applyBrand((await api.generateScenePreview(brand.id, owned.id)).brand);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setDrawing(false);
    }
  };

  // The analyzer already knows how to revise rather than restart; this is the
  // only thing that was missing, and without it a scene built before it learned
  // to read human presence could never be brought forward.
  const rereadRefs = async () => {
    if (!owned || rereading) return;
    setRereading(true);
    setErr(null);
    try {
      await api.rereadScene(brand.id, owned.id);
      // Deliberately stays disabled. This call returns a job id the moment the
      // work starts, not when it finishes, so releasing the button here would
      // offer a second analyzer run over the same record while the first is
      // still going - two real Codex calls racing to write one scene. Progress
      // shows in the bell, the same as any other build.
    } catch (e: any) {
      setErr(String(e.message ?? e));
      setRereading(false);
    }
  };

  const remove = async () => {
    if (!owned) return;
    setBusy(true);
    try {
      await api.deleteScene(brand.id, owned.id);
      navigate(scenesPath(brand));
    } catch (e: any) {
      setErr(String(e.message ?? e));
      setBusy(false);
    }
  };

  if (!loaded && !owned) {
    return (
      <ScrollPane>
        <main className="sc-lookpage" id="main">
          <div className="sc-tplrow" aria-hidden />
        </main>
      </ScrollPane>
    );
  }

  if (error && !owned) {
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
            <Link className="sc-btn sc-btn-primary" to={`${hubPath(brand)}?compose=1`}>
              Start from scratch
            </Link>
            <Link className="sc-btn sc-btn-ghost" to={scenesPath(brand)}>
              Browse all scenes
            </Link>
          </div>
          {recovery.length > 0 && (
            <Slider label="You might like">
              {recovery.map((s) => (
                <SceneCard
                  key={s.id}
                  scene={s}
                  variant="navigate"
                  size="slider"
                  onOpen={openScene}
                  href={scenePath(brand, s.id)}
                />
              ))}
            </Slider>
          )}
        </main>
      </ScrollPane>
    );
  }

  const visibleRefs = openAll ? refs : refs.slice(0, collapsedCap);
  const frames = owned
    ? owned.previewUrl
      ? [owned.previewUrl]
      : []
    : refs.length
      ? visibleRefs
      : scene.previewUrl
        ? [scene.previewUrl]
        : [];
  // Product/either scenes ship their reference gallery shot with a demo
  // product standing in for the art direction — the caption says so, so
  // nobody mistakes it for part of the scene's recipe. Person-only scenes
  // never carry a demo product, so they skip it.
  const showDemoProductNote = !owned && scene.subject !== 'person' && frames.length > 0;

  const marked = marks.includes(scene.id);
  return (
    <ScrollPane>
      <main className="sc-lookpage" id="main">
        <div className="sc-lookpage-crumb">
          <Link to={scenesPath(brand)}>Scenes</Link>
          <span>/</span>
          <span>{owned ? 'Yours' : scene.collections[0]}</span>
        </div>

        {owned ? (
          <TextField.Root
            className="sc-ownededit-title"
            value={draftName}
            aria-label="Scene name"
            onChange={(e) => {
              setDraftName(e.target.value);
              patch({ name: e.target.value });
            }}
          />
        ) : (
          <h1>{scene.name}</h1>
        )}
        {owned ? (
          <TextField.Root
            className="sc-ownededit-lede"
            value={draftDescription}
            placeholder="One sentence for the card"
            aria-label="Description"
            onChange={(e) => {
              setDraftDescription(e.target.value);
              patch({ description: e.target.value });
            }}
          />
        ) : (
          <p className="sc-lookpage-lede">{scene.description}</p>
        )}
        <p className="sc-lookpage-facts">
          {scene.lighting} · {scene.subject === 'either' ? 'product or person' : `for a ${scene.subject}`} ·{' '}
          {scene.width === scene.height ? 'square by default' : `${scene.width}×${scene.height} by default`}
        </p>
        <div className="sc-lookpage-acts">
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => void applyScene(scene.id)}>
            Use in a shot
          </button>
          {/* Bookmarked scenes get their own tab on /scenes, and lead the shelf on Home. */}
          {!owned && (
            <button
              type="button"
              className="sc-btn sc-btn-ghost"
              aria-pressed={marked}
              onClick={() => setMarks(toggleBookmarkScene(brandId, scene.id))}
            >
              <BookmarkSimple size={13} weight={marked ? 'fill' : 'regular'} />
              <span>{marked ? 'Bookmarked' : 'Bookmark'}</span>
            </button>
          )}
          {owned && (
            <button
              type="button"
              className="sc-btn sc-btn-ghost"
              disabled={drawing}
              onClick={() => void redrawPreview()}
            >
              {drawing ? <Spinner size="1" /> : <ArrowClockwise size={13} />}
              <span>{owned.previewUrl ? 'Redraw the example' : 'Draw an example'}</span>
            </button>
          )}
          {owned && owned.refs.length > 0 && (
            <button
              type="button"
              className="sc-btn sc-btn-ghost"
              disabled={rereading}
              onClick={() => void rereadRefs()}
            >
              {rereading ? <Spinner size="1" /> : <Eye size={13} />}
              <span>{rereading ? 'Reading the references' : 'Read the references again'}</span>
            </button>
          )}
        </div>
        {err && <p className="sc-assetform-err">{err}</p>}

        {frames.length > 0 ? (
          <>
            <div className="sc-lookpage-refs">
              {frames.map((src) => (
                <RefFrame key={src} src={src} />
              ))}
            </div>
            {showDemoProductNote && (
              <p className="sc-lookpage-note">Shown with a demo product for reference. Yours replaces it.</p>
            )}
            {owned && (
              <p className="sc-lookpage-note">
                {owned?.figure
                  ? 'An example of this scene. The person in it is nobody: attach a presenter and they take the role.'
                  : 'The place with nothing staged in it. Whatever you attach to a shot goes here.'}
              </p>
            )}
            {!owned && refs.length > collapsedCap && (
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

        {owned && (
          <div className="sc-ownedbits">
            {owned.refs.length > 0 && (
              <section>
                <p className="sc-bandhead">Your references</p>
                <p className="sc-ownedbits-note">
                  What this scene was read from, and what its example above was drawn from.
                  {owned.figure
                    ? ' Because this scene is built around a figure, one of these also goes to the shot as reference for the world and the treatment. The people, products and marks in it are never copied.'
                    : ' A scene reaches a shot as words, never as pixels, so nothing staged in these images can turn up in a render on its own.'}
                </p>
                <div className="sc-lookpage-refs">
                  {owned.refs.map((src) => (
                    <RefFrame key={src} src={src} />
                  ))}
                </div>
              </section>
            )}

            {owned.figure && (
              <section>
                <p className="sc-bandhead">Who it is built around</p>
                <p className="sc-ownedbits-note">
                  {owned.figure}
                  {owned.figureTreatment ? `, and ${owned.figureTreatment}` : ''}. A role, not a person: attach a
                  presenter and they play it. Their own face stays theirs underneath.
                </p>
              </section>
            )}

            <section>
              <p className="sc-bandhead">The place itself</p>
              <p className="sc-ownedbits-note">
                Sent with every shot built here. Describe the world, not what stands in it.
              </p>
              <TextArea
                value={draftPrompt}
                rows={5}
                onChange={(e) => {
                  setDraftPrompt(e.target.value);
                  patch({ prompt: e.target.value });
                }}
              />
              <TextField.Root
                mt="2"
                value={draftLighting}
                placeholder="The light, in a short phrase"
                aria-label="Lighting"
                onChange={(e) => {
                  setDraftLighting(e.target.value);
                  patch({ lighting: e.target.value });
                }}
              />
            </section>

            <section>
              <p className="sc-bandhead">Direction</p>
              <p className="sc-ownedbits-note">
                What matters in these references, and what to ignore. Read again to apply it.
              </p>
              <textarea
                className="sc-in"
                rows={3}
                maxLength={400}
                placeholder="What matters in these references, and what to ignore"
                defaultValue={owned.instruction ?? ''}
                onChange={(e) => patch({ instruction: e.target.value })}
              />
            </section>

            <div className="sc-lookpage-acts">
              <Confirm
                label="Delete scene"
                title={`Delete ${owned.name}?`}
                body="Shots already made here keep their images and their recipe. Only future shots lose it."
                busy={busy}
                onConfirm={() => void remove()}
              />
            </div>
          </div>
        )}

        {made.length > 0 && (
          <Slider label="Your shots in this scene">
            {made.map((s) => (
              <ShotThumb key={s.id} node={s} to={shotPath(brand, null, s.id)} />
            ))}
          </Slider>
        )}

        {near.length > 0 && (
          <Slider label="Other scenes, similar light">
            {near.map((s) => (
              <SceneCard
                key={s.id}
                scene={s}
                variant="navigate"
                size="slider"
                onOpen={openScene}
                href={scenePath(brand, s.id)}
              />
            ))}
          </Slider>
        )}
      </main>
    </ScrollPane>
  );
}
