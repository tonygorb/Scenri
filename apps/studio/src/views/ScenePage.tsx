import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type Scene, type SceneSetup, thumbOf } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useMadeWith } from './useMadeWith.js';
import { useTitleEntity } from '../useDocumentTitle.js';
import { customSceneById } from '../brandAssets.js';
import { hubPath, sceneEditPath, scenePath, scenesPath, shotPath } from '../routes.js';
import { useApplyScene } from '../app/useApplyScene.js';
import { bookmarkedScenes, toggleBookmarkScene } from '../bookmarks.js';
import { Confirm } from '../Confirm.js';
import { SceneCard } from '../layout/SceneCard.js';
import { BookmarkSimple, CaretDown, PencilSimple, Plus } from '@phosphor-icons/react';
import { DropdownMenu } from '@radix-ui/themes';
import { readingLines } from '../create/scene/sceneStudioRules.js';
import { COPY } from '../create/scene/sceneCopy.js';
import { framingsLeft, SETUPS_MAX } from '../create/scene/sceneSetups.js';
import { Tip } from '../layout/Tip.js';
import { AssetDetailsDialog } from './AssetDetailsDialog.js';
import { EmptyRefFrame, ShotThumb, Shown, Slider } from '../layout/ReferenceGallery.js';
import { Rail } from '../layout/Rail.js';
import { ImageLightbox } from '../composer/ImageLightbox.js';
import { bookmarkedFirst } from '../layout/library/libraryRules.js';
import { ScrollPane } from '../layout/ScrollPane.js';

/**
 * One scene, as the world it is.
 *
 * The same three zones a presenter's record page has, for the same reason: a
 * record is read top to bottom, and the pictures are the middle of it. The
 * name and the one verb that uses it are first; the pictures of the place are
 * a rail that may leave the column, each labelled for what it is and each
 * opening at full size; then what a shot is told, in words, which is the scene
 * itself. Below that, what you made here, which is the proof the world is
 * reusable.
 *
 * It was a centred lede over one lonely 380px tile with two paragraphs of
 * caption under it, which read as an asset detail rather than a place to shoot
 * in.
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
  /** The picture opened at full size, and what to call it there. */
  const [open, setOpen] = useState<{ src: string; label: string } | null>(null);
  /** The long set prose, which waits behind a press. */
  const [openWords, setOpenWords] = useState(false);

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

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  // every vertical any scene is filed under, so a new filing lands in a tab that exists
  const known = useMemo(() => [...new Set(scenes.flatMap((s) => s.verticals))].sort(), [scenes]);

  /**
   * The name and the filing, written once when the sheet is saved. The words a
   * shot is told, the pictures and the preview are changed in the studio,
   * because changing them means drawing, and this page never draws.
   */
  const saveDetails = async (next: { name: string; categories: string[] }) => {
    if (!owned) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.updateScene(brand.id, owned.id, { name: next.name, verticals: next.categories });
      applyBrand(r.brand);
      setDetails(false);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * One more way to shoot this world, written straight onto the record.
   *
   * Metadata, like the name and the filing beside it: nothing is drawn for a
   * setup, because what changes is where the camera stands and the picture of
   * the place already says what the place is.
   */
  const addSetup = async (f: SceneSetup) => {
    if (!owned) return;
    setErr(null);
    try {
      const r = await api.updateScene(brand.id, owned.id, { setups: [...(owned.setups ?? []), f] });
      applyBrand(r.brand);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  };

  const remove = async () => {
    if (!owned) return;
    setBusy(true);
    try {
      const r = await api.deleteScene(brand.id, owned.id);
      // Before navigating, not after: the wall this lands on is rendered from
      // the brand, and without this it still carried the card, the picker
      // still offered it and an existing chip still resolved, until a reload.
      applyBrand(r.brand);
      navigate(scenesPath(brand));
    } catch (e: any) {
      setErr(String(e.message ?? e));
      setBusy(false);
    }
  };

  if (!loaded && !owned) {
    return (
      <ScrollPane>
        <main className="sc-lookpage sc-scenepage" id="main">
          <div className="sc-tplrow" aria-hidden />
        </main>
      </ScrollPane>
    );
  }

  if (error && !owned) {
    return (
      <ScrollPane>
        <main className="sc-lookpage sc-scenepage" id="main">
          <div className="sc-scene-state">
            <h1>Couldn't load this scene</h1>
            <p className="sc-lookpage-lede">Something went wrong reaching the catalog.</p>
            <div className="sc-lookpage-acts">
              <button type="button" className="sc-btn sc-btn-primary" onClick={() => refetch()}>
                Retry
              </button>
            </div>
          </div>
        </main>
      </ScrollPane>
    );
  }

  if (!scene) {
    return (
      <ScrollPane>
        <main className="sc-lookpage sc-scenepage" id="main">
          <div className="sc-scene-state">
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
          </div>
        </main>
      </ScrollPane>
    );
  }

  /**
   * The pictures of this place, each with what it is.
   *
   * One walk, so a label can never drift off its picture. Yours is the one
   * drawn from the words; a curated scene carries a set shot in it, and a
   * scene older than either has only its card.
   */
  const frames: { src: string; label: string }[] = owned
    ? owned.previewUrl
      ? [{ src: owned.previewUrl, label: 'The place' }]
      : []
    : refs.length
      ? refs.map((src, i) => ({ src, label: `Example ${i + 1}` }))
      : scene.previewUrl
        ? [{ src: scene.previewUrl, label: 'The place' }]
        : [];
  // Product/either scenes ship their reference gallery shot with a demo
  // product standing in for the art direction — the caption says so, so
  // nobody mistakes it for part of the scene's recipe. Person-only scenes
  // never carry a demo product, so they skip it.
  const showDemoProductNote = !owned && scene.subject !== 'person' && frames.length > 0;

  const marked = marks.includes(scene.id);
  // The words, split: what this world controls is scannable, and the long set
  // prose it is compiled from waits behind one press. Nobody opens a scene to
  // read four hundred words of description; they open it to see the place and
  // use it.
  const told = owned
    ? readingLines({
        name: owned.name,
        prompt: owned.prompt,
        lighting: owned.lighting,
        camera: owned.camera,
        figure: owned.figure,
        figureTreatment: owned.figureTreatment,
        subject: owned.subject,
        description: owned.description,
      })
    : [];
  const prose = told.find((l) => l.label === COPY.placeLabel);
  const controls = told.filter((l) => l !== prose);

  return (
    <ScrollPane>
      <main className="sc-lookpage sc-scenepage" id="main">
        <div className="sc-lookpage-crumb">
          <Link to={scenesPath(brand)}>Scenes</Link>
          <span>/</span>
          <span>{owned ? 'Yours' : scene.collections[0]}</span>
        </div>

        {/* The place on one side, its record on the other. A record is read
            beside what it describes, not under it, and the picture is the
            thing this page is about. */}
        <div className="sc-scene-grid">
          {/* Who this is, and the one verb that uses it. Its own block, so a
              phone reads the name before the picture and the desktop still
              heads the record with it. */}
          <div className="sc-scene-id">
            <h1>{scene.name}</h1>
            <p className="sc-lookpage-lede">{scene.description}</p>
            {/* A curated scene is judged from outside, so it says what it is
                for; your own says it in its own words below. */}
            {!owned && (
              <p className="sc-lookpage-facts">
                {scene.lighting} · {scene.subject === 'either' ? 'product or person' : `for a ${scene.subject}`} ·{' '}
                {scene.width === scene.height ? 'square by default' : `${scene.width}×${scene.height} by default`}
              </p>
            )}
            <div className="sc-lookpage-acts">
              <button type="button" className="sc-btn sc-btn-primary" onClick={() => void applyScene(scene.id)}>
                Use in a shot
              </button>
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
                <Link className="sc-btn sc-btn-ghost" to={sceneEditPath(brand, owned.id)}>
                  Edit scene
                </Link>
              )}
              {owned && (
                <Tip label="Edit name and details">
                  <button
                    type="button"
                    className="sc-icon-btn"
                    aria-label="Edit name and details"
                    aria-haspopup="dialog"
                    onClick={() => setDetails(true)}
                  >
                    <PencilSimple size={17} />
                  </button>
                </Tip>
              )}
            </div>
            {err && <p className="sc-assetform-err">{err}</p>}
          </div>

          <div className="sc-scene-stage">
            {frames.length > 1 ? (
              <Rail
                count={frames.length}
                label="Pictures of this place"
                className="sc-refset-rail"
                trackClassName="sc-refset"
              >
                {frames.map((f) => (
                  <li key={f.src}>
                    <button
                      type="button"
                      className="sc-refset-tile"
                      aria-label={`${f.label}, open`}
                      onClick={() => setOpen(f)}
                    >
                      <Shown src={thumbOf(f.src, 'small')} />
                    </button>
                    <span className="sc-refset-lb" aria-hidden>
                      {f.label}
                    </span>
                  </li>
                ))}
              </Rail>
            ) : frames.length === 1 ? (
              <figure className="sc-scene-place">
                <button type="button" aria-label={`${frames[0].label}, open`} onClick={() => setOpen(frames[0])}>
                  <Shown src={thumbOf(frames[0].src, 'tile')} />
                </button>
                <figcaption className="sc-lookpage-note">
                  {owned
                    ? owned.figure
                      ? 'Drawn from these words. The person in it is a stand-in: attach a presenter and they take the role.'
                      : 'Drawn from these words. Whatever you attach to a shot goes here.'
                    : showDemoProductNote
                      ? 'Shown with a demo product for reference. Yours replaces it.'
                      : 'An example shot in this place, made from the words below.'}
                </figcaption>
              </figure>
            ) : (
              <EmptyRefFrame />
            )}
            {frames.length > 1 && showDemoProductNote && (
              <p className="sc-lookpage-note">Shown with a demo product for reference. Yours replaces it.</p>
            )}

            {/* What has been made here: the proof that the world is reusable. */}
            {made.length > 0 && (
              <section className="sc-scene-band">
                <p className="sc-bandhead">Made here</p>
                <div className="sc-scene-made">
                  {made.map((s) => (
                    <ShotThumb key={s.id} node={s} to={shotPath(brand, null, s.id)} />
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="sc-scene-rec">
            {owned && (
              <>
                {/* Ways to shoot this same world: the camera moves, the world
                    does not, so each one is a label and a line. */}
                <section className="sc-scene-sec">
                  <p className="sc-bandhead">Ways to shoot it</p>
                  <div className="sc-setups-row">
                    {(owned.setups ?? []).map((v) => (
                      <Tip key={v.id} label={v.camera}>
                        <button
                          type="button"
                          className="sc-btn sc-btn-ghost"
                          onClick={() => void applyScene(owned.id, v.id)}
                        >
                          {v.label}
                        </button>
                      </Tip>
                    ))}
                    {framingsLeft(owned.setups).length > 0 && (owned.setups?.length ?? 0) < SETUPS_MAX && (
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger>
                          <button type="button" className="sc-btn sc-btn-ghost" aria-label="Add a way to shoot it">
                            <Plus size={12} />
                            <span>Add a way</span>
                          </button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content>
                          {framingsLeft(owned.setups).map((f) => (
                            <DropdownMenu.Item key={f.id} onSelect={() => void addSetup(f)}>
                              {f.label}
                            </DropdownMenu.Item>
                          ))}
                        </DropdownMenu.Content>
                      </DropdownMenu.Root>
                    )}
                  </div>
                  <p className="sc-scene-note">
                    Only where the camera stands changes. Your own words in a shot still win.
                  </p>
                </section>

                <section className="sc-scene-sec">
                  <p className="sc-bandhead">What your shots are told</p>
                  <dl className="sc-lookpage-told">
                    {controls.map((l) => (
                      <div key={l.label}>
                        <dt>{l.label}</dt>
                        <dd dir="auto">{l.text}</dd>
                      </div>
                    ))}
                  </dl>
                  {prose && (
                    <>
                      <button
                        type="button"
                        className="sc-scene-expand"
                        aria-expanded={openWords}
                        aria-controls="scene-full-words"
                        onClick={() => setOpenWords(!openWords)}
                      >
                        <CaretDown size={12} weight="bold" data-on={openWords || undefined} />
                        <span>{openWords ? 'Hide the full words' : 'Read the full words a shot is told'}</span>
                      </button>
                      {openWords && (
                        <p className="sc-scene-prose" id="scene-full-words" dir="auto">
                          {prose.text}
                        </p>
                      )}
                    </>
                  )}
                  {owned.instruction && (
                    <p className="sc-scene-note" dir="auto">
                      Your words: {owned.instruction}
                    </p>
                  )}
                </section>

                {owned.refs.length > 0 && (
                  <section className="sc-scene-sec">
                    <p className="sc-bandhead">What it was read from</p>
                    <div className="sc-presenterpage-sources-row">
                      {owned.refs.map((src, i) => (
                        <button
                          key={src}
                          type="button"
                          className="sc-presenterpage-source"
                          aria-label={`Read from ${i + 1}, open`}
                          onClick={() => setOpen({ src, label: `Read from ${i + 1}` })}
                        >
                          <Shown src={thumbOf(src, 'micro')} />
                        </button>
                      ))}
                    </div>
                    <p className="sc-scene-note">
                      Read into the words, never sent with a shot. Nobody in them is ever copied.
                    </p>
                  </section>
                )}

                {owned.verticals.length > 0 && (
                  <div className="sc-scene-sec sc-presenterpage-filed">
                    <span className="sc-presenterpage-filed-lb">Filed under</span>
                    <ul className="sc-presenterpage-cats" aria-label="Filed under">
                      {owned.verticals.map((c) => (
                        <li key={c} className="sc-chip" data-static>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="sc-scene-sec sc-scene-del">
                  <Confirm
                    label="Delete scene"
                    title={`Delete ${owned.name}?`}
                    body="Shots already made here keep their images and their recipe. Only future shots lose it."
                    busy={busy}
                    onConfirm={() => void remove()}
                  />
                </div>
              </>
            )}
          </aside>
        </div>

        {details && owned && (
          <AssetDetailsDialog
            name={owned.name}
            categories={owned.verticals}
            known={known}
            hint="The verticals this place suits, so it surfaces where you work."
            busy={busy}
            error={err}
            onSave={(next) => void saveDetails(next)}
            onDismiss={() => setDetails(false)}
          />
        )}

        {open && (
          <ImageLightbox
            src={open.src}
            kind="scene"
            label={open.label}
            noun={scene.name}
            onClose={() => setOpen(null)}
          />
        )}

        {/* Only for a curated scene: the nearest by light are all catalog ones,
            so on your own scene this offered somebody else's places. */}
        {!owned && near.length > 0 && (
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
