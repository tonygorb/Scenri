import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type Scene, type SceneSetup, type SceneView, thumbOf } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useMadeWith } from './useMadeWith.js';
import { useTitleEntity } from '../useDocumentTitle.js';
import { customSceneById, customScenesOf } from '../brandAssets.js';
import { hubPath, sceneEditPath, scenePath, scenesPath, shotPath } from '../routes.js';
import { useApplyScene } from '../app/useApplyScene.js';
import { bookmarkedScenes, toggleKept } from '../bookmarks.js';
import { Confirm } from '../Confirm.js';
import { SceneCard } from '../layout/SceneCard.js';
import { CaretDown, PencilSimple, Star } from '@phosphor-icons/react';
import { DropdownMenu } from '@radix-ui/themes';
import { COPY } from '../create/scene/sceneCopy.js';
import { FRAMINGS, SETUPS_MAX } from '../create/scene/sceneSetups.js';
import { sceneTailLine } from './sceneFacts.js';
import { Tip } from '../layout/Tip.js';
import { AssetDetailsDialog } from './AssetDetailsDialog.js';
import { EmptyRefFrame, ShotThumb, Shown, Slider } from '../layout/ReferenceGallery.js';
import { Rail } from '../layout/Rail.js';
import { ImageLightbox } from '../composer/ImageLightbox.js';
import { bookmarkedFirst } from '../layout/library/libraryRules.js';
import { useStillHere } from '../useStillHere.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { SceneExamples } from './SceneExamples.js';
import { SceneViewActions, SceneViewCaption } from '../layout/SceneViewActions.js';
import { EXAMPLE_LABEL } from '../sceneExampleRules.js';

/** A scene's pictures in the order of what they are: the hero, the place, then the rest of the set. */
const VIEW_ORDER: readonly SceneView[] = ['hero', 'place', 'close', 'hands', 'angle', 'bold'];

/**
 * One scene, as a record: the same page a presenter and a product have.
 *
 * Identity first and tight (the name, what it is in one sentence, what it is
 * made of in a few words, and the one verb that uses it), then the pictures of
 * the place, which is the only zone allowed to leave the column, then what a
 * shot made here is told, then the shots already made here, then the quiet
 * facts and Delete.
 *
 * Two earlier passes put this page in a two-column grid of its own with four
 * band heads, three paragraphs explaining the mechanics and the analyzer's
 * eight hundred characters of set prose. That prose belongs to the studio that
 * writes it, the same rule the presenter's casting prose already follows, and
 * the rest was a page that read once and was skipped ever after.
 */
export function ScenePage() {
  const { sceneId } = useParams();
  const { scenes: catalog, loaded, error, refetch, applyBrand, refreshBrands } = useAppData();
  // one ask upstairs holds the whole brand now, so this page no longer walks
  // twenty project trees to answer "what did this scene actually produce"
  const { brand } = useBrand();
  const scenes = catalog;
  const navigate = useNavigate();
  const applyScene = useApplyScene();
  const brandId = brand.id;
  const [refs, setRefs] = useState<string[]>([]);
  /** A curated scene's frames by what they show, when its library names them. */
  const [views, setViews] = useState<{ view: SceneView; url: string }[]>([]);
  const [viewBusy, setViewBusy] = useState(false);
  const [marks, setMarks] = useState<string[]>(() => bookmarkedScenes(brandId));
  /** The picture opened at full size, what to call it there, and which view it is. */
  const [open, setOpen] = useState<{ src: string; label: string; view?: SceneView } | null>(null);

  const openScene = (id: string) => navigate(scenePath(brand, id));

  // The brand's own places come before the catalog, the same order the
  // compiler resolves them in.
  const owned = customSceneById(brand, sceneId ?? '');
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
    setViews([]);
    // A scene built here carries its own images; only a curated one has a
    // reference set sitting on disk to go and ask about.
    if (isOwned) return;
    void api
      .sceneFrames(sceneId ?? '')
      .then((r) => {
        if (!alive) return;
        setRefs(r.frames);
        setViews(r.views ?? []);
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

  /**
   * Other curated places with the same light, for a curated scene only.
   *
   * Never for your own: the pool is the catalog, so a brand's own scene was
   * offered eight of somebody else's places under the heading "similar".
   */
  const near = useMemo(() => {
    if (!scene || isOwned) return [];
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
  }, [scenes, scene, isOwned]);

  /** Keepers first, the same ordering rule as Home's scene shelf. */
  const recovery = useMemo(() => {
    if (scene || !loaded || error) return [];
    const marks = bookmarkedScenes(brandId);
    return bookmarkedFirst(scenes, (s) => marks.includes(s.id)).slice(0, 6);
  }, [scene, loaded, error, scenes, brandId]);

  const [err, setErr] = useState<string | null>(null);
  /**
   * Two writes, two flags. A save in the Details sheet used to disable Delete,
   * which reads as prudence and is not: they touch different things, and a
   * rename still out cannot make a delete wrong. Sharing one flag also made a
   * real race untestable by making it impossible.
   */
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState(false);
  /** One delete at a time, however many times the button is pressed. */
  const removing = useRef(false);
  const stillHere = useStillHere();

  /**
   * What to offer when filing it.
   *
   * The catalog's facets plus this brand's own, because a vertical invented in
   * the studio was not in the catalog list and so could never be picked again
   * here. The presenter page has said this for longer and says why.
   */
  const known = useMemo(
    () =>
      [...new Set([...scenes.flatMap((s) => s.verticals), ...customScenesOf(brand).flatMap((s) => s.verticals)])].sort(
        (a, b) => a.localeCompare(b),
      ),
    [scenes, brand],
  );

  /**
   * The name, the filing and the ways to shoot it, written once when the sheet
   * is saved. The words a shot is told, the pictures and the preview are
   * changed in the studio, because changing them means drawing, and this page
   * never draws.
   */
  const saveDetails = async (next: { name: string; categories: string[]; ways?: SceneSetup[] }) => {
    if (!owned) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await api.updateScene(brand.id, owned.id, {
        name: next.name,
        verticals: next.categories,
        ...(next.ways ? { setups: next.ways } : {}),
      });
      applyBrand(r.brand);
      setDetails(false);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Delete, and every surface stops showing the scene in the same commit.
   *
   * The answer carries the brand as it now stands and is applied before
   * anything moves: the wall this lands on, the caret menu and the chips all
   * read that one row.
   */
  const remove = async () => {
    if (!owned || removing.current) return;
    removing.current = true;
    const here = stillHere();
    const wall = scenesPath(brand);
    setBusy(true);
    try {
      const r = await api.deleteScene(brand.id, owned.id);
      applyBrand(r.brand);
    } catch (e: any) {
      if (e?.status !== 404) {
        removing.current = false;
        if (here()) {
          setErr(String(e.message ?? e));
          setBusy(false);
        }
        return;
      }
      // Already gone (another tab, or a double press that got past the guard):
      // the outcome asked for is true, so read the brand and carry on.
      await refreshBrands();
    }
    // Replace, not push: Back must not land on the page of a scene that no
    // longer exists. And only if this page is still the one on screen.
    if (here()) navigate(wall, { replace: true });
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
        <main className="sc-lookpage sc-scenepage" id="main">
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

  /**
   * A curated scene's pictures, each with what it is.
   *
   * One walk, so a label can never drift off its picture. A curated scene
   * carries a set shot in it, and one older than its set has only its card.
   * Your own scene's pictures are SceneExamples: the place, then the place in use.
   */
  const frames: { src: string; label: string; view?: SceneView }[] = views.length
    ? // by role, never by file: the hero first, then the place, then the rest
      [...views]
        .sort((a, b) => VIEW_ORDER.indexOf(a.view) - VIEW_ORDER.indexOf(b.view))
        .map((v) => ({ src: v.url, label: v.view === 'place' ? 'The place' : EXAMPLE_LABEL[v.view], view: v.view }))
    : refs.length
      ? refs.map((src, i) => ({ src, label: `Example ${i + 1}` }))
      : scene.previewUrl
        ? [
            {
              src: scene.previewUrl,
              label: scene.cover && scene.cover !== 'place' ? EXAMPLE_LABEL[scene.cover] : 'The place',
            },
          ]
        : [];
  /** Which catalog view stands for it: Scenri's curated cover, the same for every brand. */
  const catalogCover: SceneView = scene.cover ?? 'place';
  /** A catalog view handed to one shot: copied into the store first, then the same road a made scene's takes. */
  const shootCatalogView = async (view: SceneView) => {
    if (viewBusy) return;
    setViewBusy(true);
    setErr(null);
    try {
      const { hash } = await api.pickSceneView(scene.id, view);
      applyScene(scene.id, undefined, hash, view);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setViewBusy(false);
    }
  };

  const marked = !owned && marks.includes(scene.id);
  const ways = owned?.setups ?? [];
  /**
   * The uploads it was read from, without the one already standing above as
   * the place: a scene saved before its picture was drawn falls back to its
   * first upload for the preview, which showed the same photograph twice.
   */
  const sources = (owned?.refs ?? []).filter((src) => src !== owned?.placeUrl);
  /**
   * What its pictures are, said once, in the footnote the presenter page keeps
   * for what is true about a record. Under the rail it read as a caption to
   * the middle picture.
   */
  const shownWith = owned?.examples?.find((e) => !e.earlier)?.with ?? owned?.examples?.[0]?.with;
  // What a shot is given, as brief.ts decides it: an anchor goes with every new
  // shot (one with a person in it, only beside a presenter); an older picture
  // only when its figure wears a treatment. Any picture can be picked to shoot
  // like, from its lightbox.
  const rides = !!owned && (owned.anchor === true || !!(owned.figure && owned.figureTreatment));
  const pick = owned?.previewHash || owned?.examples?.length ? ' Use a view to shoot like it.' : '';
  const about = !owned
    ? ''
    : owned.figure && rides
      ? `The person in it is a stand-in: with a presenter attached, the picture goes with the shot and they take the role.${pick}`
      : rides
        ? `${shownWith ? `Shown in use with a Scenri demo ${shownWith}. ` : ''}Shots are given its picture as their world and find their own frame in it.${pick}`
        : shownWith
          ? `Shown in use with a Scenri demo ${shownWith}. Shots are told the words.${pick}`
          : owned.placeUrl
            ? `Shots are told the words.${pick}`
            : '';
  const tail = owned ? sceneTailLine({ refs: sources, setups: owned.setups }, about) : '';

  return (
    <ScrollPane>
      <main className="sc-lookpage sc-scenepage" id="main">
        <h1>{scene.name}</h1>
        {/* Where it is filed, as the app's own chips, above the caption: the
            presenter page's order, and the thing a place is scanned for. */}
        {scene.verticals.length > 0 && (
          <ul className="sc-lookpage-cats" aria-label="Filed under">
            {scene.verticals.map((c) => (
              <li key={c} className="sc-chip" data-static>
                {c}
              </li>
            ))}
          </ul>
        )}
        <p className="sc-lookpage-lede">{scene.description}</p>

        <div className="sc-lookpage-acts">
          {/* One verb. A scene with ways to shoot it keeps them on the verb
              rather than in a band of their own: a way is how you press this
              button, not a section to read. */}
          {ways.length > 0 ? (
            <span className="sc-splitbtn">
              <button
                type="button"
                className="sc-btn sc-btn-primary sc-splitbtn-go"
                onClick={() => void applyScene(scene.id)}
              >
                Use in a shot
              </button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <button type="button" className="sc-btn sc-btn-primary sc-splitbtn-more" aria-label="Use it a way">
                    <CaretDown size={12} weight="bold" aria-hidden />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  {ways.map((v) => (
                    <DropdownMenu.Item key={v.id} onSelect={() => void applyScene(scene.id, v.id)}>
                      {v.label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </span>
          ) : (
            <button type="button" className="sc-btn sc-btn-primary" onClick={() => void applyScene(scene.id)}>
              Use in a shot
            </button>
          )}
          {owned ? (
            <Link className="sc-btn sc-btn-ghost" to={sceneEditPath(brand, owned.id)}>
              Edit scene
            </Link>
          ) : (
            <button
              type="button"
              className="sc-btn sc-btn-ghost"
              aria-pressed={marked}
              onClick={() => setMarks(toggleKept('scene', brandId, scene.id))}
            >
              <Star size={13} weight={marked ? 'fill' : 'regular'} />
              <span>{marked ? 'Remove from Keepers' : 'Add to Keepers'}</span>
            </button>
          )}
          {owned && (
            <Tip label="Edit name, filing and ways">
              <button
                type="button"
                className="sc-icon-btn"
                aria-label="Edit name, filing and ways"
                aria-haspopup="dialog"
                onClick={() => setDetails(true)}
              >
                <PencilSimple size={17} />
              </button>
            </Tip>
          )}
        </div>
        {err && <p className="sc-assetform-err">{err}</p>}

        {/* The place itself, and the only zone allowed to leave the column: a
            curated scene's examples stand side by side the way a presenter's
            views do, and so do your own scene's, after its place. */}
        {owned ? (
          <SceneExamples key={owned.id} brandId={brand.id} scene={owned} onError={setErr} />
        ) : frames.length > 1 ? (
          <Rail
            count={frames.length}
            label="Pictures of this place"
            className="sc-refset-rail"
            trackClassName="sc-refset"
          >
            {frames.map((f) => (
              <li key={f.src}>
                <span className="sc-sceneview-frame" data-cover={f.view === catalogCover || undefined}>
                  <button
                    type="button"
                    className="sc-refset-tile"
                    aria-label={`${f.label}${f.view === catalogCover ? ', the cover' : ''}, open`}
                    onClick={() => setOpen(f)}
                  >
                    <Shown src={thumbOf(f.src, 'small')} />
                  </button>
                  {f.view && (
                    <SceneViewActions
                      variant="tile"
                      label={f.label}
                      isCover={f.view === catalogCover}
                      onOpen={() => setOpen(f)}
                      onUse={() => void shootCatalogView(f.view as SceneView)}
                      busy={viewBusy}
                    />
                  )}
                </span>
                <SceneViewCaption label={f.label} isCover={f.view === catalogCover} />
              </li>
            ))}
          </Rail>
        ) : frames.length === 1 ? (
          <div className="sc-scenepage-place">
            <button
              type="button"
              className="sc-scenepage-open"
              aria-label={`${frames[0].label}, open`}
              onClick={() => setOpen(frames[0])}
            >
              <Shown src={thumbOf(frames[0].src, 'tile')} />
            </button>
          </div>
        ) : (
          <EmptyRefFrame />
        )}

        {/* What a shot made here is told, in the three keys that are real. The
            set prose behind them is the studio's, and Edit scene is the way to
            it: it is eight hundred characters long and it is changed by
            re-reading the place, never by reading it here. */}
        {owned && (
          <section className="sc-scenepage-told">
            <dl className="sc-lookpage-told">
              <div>
                <dt>{COPY.lightLabel}</dt>
                <dd dir="auto">{owned.lighting}</dd>
              </div>
              {owned.camera && (
                <div>
                  <dt>{COPY.cameraLabel}</dt>
                  <dd dir="auto">{owned.camera}</dd>
                </div>
              )}
              {owned.figure && (
                <div>
                  <dt>{COPY.figureLabel}</dt>
                  <dd dir="auto">{owned.figure}</dd>
                </div>
              )}
            </dl>
            <p className="sc-lookpage-note">Every shot made here is told this. Anything you write in the shot wins.</p>
          </section>
        )}

        {sources.length > 0 && (
          <section className="sc-presenterpage-sources">
            <p className="sc-presenterpage-sources-lb">What it was read from</p>
            <div className="sc-presenterpage-sources-row">
              {sources.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  className="sc-presenterpage-source"
                  aria-label={`Source photo ${i + 1}, open`}
                  onClick={() => setOpen({ src, label: `Source photo ${i + 1}` })}
                >
                  <Shown src={thumbOf(src, 'micro')} />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* The facts nobody acts on, and the one verb that ends a record. */}
        {owned && (
          <div className="sc-prec">
            {tail && <p className="sc-prec-note">{tail}</p>}
            <Confirm
              label="Delete scene"
              title={`Delete ${owned.name}?`}
              body="Shots already made here keep their images. Their recipe will say this scene is gone, and building from one again will miss it."
              busy={busy}
              onConfirm={() => void remove()}
            />
          </div>
        )}

        {/* What has been made here: the proof that a world is reusable, and
            the one thing on this page that only this page can show. */}
        {made.length > 0 && (
          <Slider label={`Shots made in ${scene.name}`}>
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

        {details && owned && (
          <AssetDetailsDialog
            name={owned.name}
            categories={owned.verticals}
            known={known}
            hint="The verticals this place suits, so it surfaces where you work."
            ways={ways}
            wayChoices={FRAMINGS}
            wayMax={SETUPS_MAX}
            busy={saving}
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
            actions={
              open.view ? (
                <SceneViewActions
                  variant="sheet"
                  label={open.label}
                  isCover={open.view === catalogCover}
                  onUse={() => void shootCatalogView(open.view as SceneView)}
                  busy={viewBusy}
                />
              ) : undefined
            }
          />
        )}
      </main>
    </ScrollPane>
  );
}
