import { ImageSquare, PencilSimple } from '@phosphor-icons/react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useMatch, useNavigate, useParams } from 'react-router';
import { api, type PresenterPatch, thumbOf } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useMadeWith } from './useMadeWith.js';
import { useTitleEntity } from '../useDocumentTitle.js';
import { assetUrl } from '../apiUploads.js';
import { customPresenterById, customPresentersOf, headPresenterId } from '../brandAssets.js';
import { presenterAvatar } from '../presenterVisual.js';
import { P, presenterEditPath, presenterPath, presentersPath, shotPath } from '../routes.js';
import { useApplyPresenter } from '../app/useApplyPresenter.js';
import { Confirm } from '../Confirm.js';
import { ImageLightbox } from '../composer/ImageLightbox.js';
import { Rail } from '../layout/Rail.js';
import { KeepButton } from '../layout/KeepButton.js';
import { Tip } from '../layout/Tip.js';
import { EmptyRefFrame, ShotThumb, Slider } from '../layout/ReferenceGallery.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { AssetDetailsDialog } from './AssetDetailsDialog.js';
import { useStillHere } from '../useStillHere.js';

/** The word under a reference tile, by the angle the record gives it. */
const ROLE_LABEL: Record<string, string> = {
  portrait: 'Face',
  identity: 'Face',
  front: 'Full body',
  'three-quarter': 'Three-quarter',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  'left-profile': 'Left',
  'right-profile': 'Right',
};

/**
 * One presenter: who they are right now.
 *
 * A calm asset profile. The avatar, the name and a caption, the few facts
 * worth reading, two things to do (use them in a shot, or edit them), and
 * the reference set: the pictures Scenri uses to understand this person,
 * each labelled by its role and opening at full size. A presenter built from
 * photographs keeps the originals in a small row of their own. Anything that
 * changes a picture or who they are lives in the editor, never here.
 */
export function PresenterPage() {
  const { presenterId = '' } = useParams();
  const {
    presenters,
    presentersLoaded,
    presentersError,
    refetchPresenters,
    applyBrand,
    refreshBrands,
    presenterCategories,
  } = useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const stillHere = useStillHere();
  const removing = useRef(false);
  const applyPresenter = useApplyPresenter();
  const [refs, setRefs] = useState<{ url: string; angle: string }[]>([]);
  const [open, setOpen] = useState<{ src: string; label: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  // The brand's own people come before the catalog, the same order the
  // compiler resolves them in.
  const owned = customPresenterById(brand, presenterId);
  const presenter = owned ?? presenters.find((p) => p.id === presenterId);
  useTitleEntity(presenter?.name);

  // The boolean, never `owned` itself: the adapter builds a fresh object every
  // render, and an effect keyed on that identity re-runs on every commit.
  const isOwned = !!owned;
  useEffect(() => {
    let alive = true;
    setRefs([]);
    if (isOwned) return;
    void api
      .presenterFrames(presenterId)
      .then((r) => {
        if (alive) setRefs(r.frames);
      })
      .catch(() => {
        if (alive) setRefs([]);
      });
    return () => {
      alive = false;
    };
  }, [presenterId, isOwned]);

  /**
   * An edit session under way for this person is offered back, never shown as
   * them. Read again when the editor closes over this page, never while it is
   * open: the editor is this page's own child route, so the page stays mounted
   * underneath and this answer would otherwise be whatever it was before the
   * session existed. Saving or discarding in there left "Continue editing"
   * standing over a session that had just ended.
   */
  const inEditor = !!useMatch({ path: P.presenterEdit });
  useEffect(() => {
    let alive = true;
    setEditing(null);
    if (!isOwned || inEditor) return;
    void api
      .presenterDrafts(brand.id)
      .then((r) => {
        if (!alive) return;
        const mine = r.drafts.find((d) => (d as { presenterId?: string }).presenterId === presenterId);
        setEditing(mine?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [brand.id, presenterId, isOwned, inEditor]);

  // Older brands may still have a roster copy from before presenters attached
  // straight from the catalog; both ids are matched to keep that history visible.
  const roster: any[] = (brand.json?.characters ?? []) as any[];
  const inRoster = roster.find((c) => c.presenterId === presenterId);
  const record = roster.find((c) => c.id === presenterId);
  const made = useMadeWith(brand.id, [presenterId ?? '', inRoster?.id ?? '']);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);

  /**
   * The words on the record, written once when the dialog is saved.
   *
   * This used to be a 500ms debounce behind two inline fields, with a flush
   * on unmount to catch the last keystroke. A dialog with a Save has one
   * moment to write in, so the timer, the pending patch and the unmount
   * flush all go: there is nothing left to lose on the way out.
   */
  const save = async (next: PresenterPatch) => {
    if (!owned) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.updatePresenter(brand.id, owned.id, next);
      applyBrand(r.brand);
      setDetails(false);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!owned || removing.current) return;
    removing.current = true;
    const here = stillHere();
    const wall = presentersPath(brand);
    setBusy(true);
    try {
      const r = await api.deletePresenter(brand.id, owned.id);
      // Before navigating, not after: the wall this lands on is rendered from
      // the brand, and without this it still carried the card, the picker still
      // offered them and an existing chip still resolved, all until a reload.
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
      // Already gone: the outcome asked for is true, so read the brand and carry on.
      await refreshBrands();
    }
    // Replace: Back must not land on the page of somebody who is gone. And only
    // if this page is still the one on screen.
    if (here()) navigate(wall, { replace: true });
  };

  // A superseded revision's address lands on the current one, the way a
  // brand reached by id lands on its slug: old links keep working.
  const head = headPresenterId(brand, presenterId);
  if (head !== presenterId) return <Navigate to={presenterPath(brand, head)} replace />;

  if (!presentersLoaded && !owned) {
    return (
      <ScrollPane>
        <main className="sc-lookpage" id="main">
          <div className="sc-tplrow" aria-hidden />
        </main>
      </ScrollPane>
    );
  }

  if (presentersError && !owned) {
    return (
      <ScrollPane>
        <main className="sc-lookpage" id="main">
          <h1>Couldn't load this presenter</h1>
          <p className="sc-lookpage-lede">Something went wrong reaching the catalog.</p>
          <div className="sc-lookpage-acts">
            <button type="button" className="sc-btn sc-btn-primary" onClick={() => refetchPresenters()}>
              Retry
            </button>
          </div>
        </main>
      </ScrollPane>
    );
  }

  if (!presenter) {
    return (
      <ScrollPane>
        <main className="sc-lookpage" id="main">
          <h1>This presenter isn't here anymore</h1>
          <p className="sc-lookpage-lede">They may have been removed from the catalog, or the link is out of date.</p>
          <div className="sc-lookpage-acts">
            <Link className="sc-btn sc-btn-primary" to={presentersPath(brand)}>
              Browse presenters
            </Link>
          </div>
        </main>
      </ScrollPane>
    );
  }

  /**
   * The reference set, each picture with the role the record gives it.
   *
   * One walk of the record, so the two cannot come apart. The labels used to
   * be indexed off the raw shots while the pictures came from the filtered
   * url list, so a single ref that resolved to nothing shifted every later
   * role word by one: a full body captioned Face.
   */
  const frames: { src: string; label: string; angle?: string }[] = owned
    ? ((Array.isArray(record?.shots) ? record.shots : []) as any[])
        .map((sh, i) => ({
          src: assetUrl(sh?.file),
          label: ROLE_LABEL[sh?.angle ?? ''] ?? `Reference ${i + 1}`,
          angle: typeof sh?.angle === 'string' ? sh.angle : undefined,
        }))
        .filter((f): f is { src: string; label: string; angle: string | undefined } => !!f.src)
    : refs.length
      ? refs.map((f, i) => ({ src: f.url, label: ROLE_LABEL[f.angle] ?? `Reference ${i + 1}`, angle: f.angle }))
      : presenter.previewUrl
        ? [{ src: presenter.previewUrl, label: 'Preview' }]
        : [];
  // One way into the editor. A session already under way is the same door
  // with the honest word on it, never a third button beside the other two.
  const editHref = presenterEditPath(brand, presenterId);
  // Age only. `hair` is a sentence of up to 120 characters written for the
  // generator, and the caption beside it already says the short version
  // ("copper curls", "tousled blond waves"); printing both put a paragraph
  // of grey prose where two words belong. The full text stays in the editor.
  // A face, at face size. `presenterVisual` is the one chain that answers
  // "what goes in a presenter's circle": the purpose-built square head crop
  // when the record has one, and a `crop` hint when it had to fall back to a
  // picture framed for something else. Both of these records carry a real
  // avatar, so the circle is a real face rather than a torso squeezed round.
  const face = presenterAvatar(owned ?? presenter);

  /**
   * What to offer when filing them.
   *
   * The catalog's own facets are read off the curated presenters, so a category
   * this brand invented could never be picked again: it was not in the list, and
   * the person who had just typed it had to type it a second time.
   */
  const known = [
    ...new Set([...presenterCategories, ...customPresentersOf(brand).flatMap((p) => p.suitableCategories ?? [])]),
  ].sort((a, b) => a.localeCompare(b));

  return (
    <ScrollPane>
      <main className="sc-lookpage sc-presenterpage" id="main">
        {face.src && (
          <div className="sc-presenterpage-avatar">
            <Shown src={thumbOf(face.src, 'small')} crop={face.crop} />
          </div>
        )}

        <h1>{presenter.name}</h1>
        {/* The verticals they suit, as the app's own chips. They belong with
            the person, not in the record below: this is the thing you scan a
            presenter for. Changing them is in Details.

            Above the caption, not under it: chips and buttons are the same
            pill, so a row of each with nothing between them read as one bank
            of controls. The caption is the thing that keeps them apart. */}
        {presenter.suitableCategories.length > 0 && (
          <ul className="sc-lookpage-cats" aria-label="Filed under">
            {presenter.suitableCategories.map((c) => (
              <li key={c} className="sc-chip" data-static>
                {c}
              </li>
            ))}
          </ul>
        )}

        {presenter.descriptor && <p className="sc-lookpage-lede">{presenter.descriptor}</p>}

        <div className="sc-lookpage-acts">
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => applyPresenter(presenterId)}>
            Use in a shot
          </button>
          {owned && (
            <Link className="sc-btn sc-btn-ghost" to={editHref}>
              {editing ? 'Continue editing' : 'Edit presenter'}
            </Link>
          )}
          <KeepButton kind="presenter" brandId={brand.id} id={presenter.id} />
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

        {/* The set is read across, not through: these are one person from
            several sides, and the question they answer is whether the sides
            agree. So every reference stands at once, at the same height, the
            way a turnaround is drawn. Face fills its card; a full-length
            frame that is taller than 4:5 letterboxes rather than losing its
            feet. The angle on the tile is the hook for that, not the label. */}
        {frames.length > 0 ? (
          <Rail count={frames.length} label="Reference set" className="sc-refset-rail" trackClassName="sc-refset">
            {frames.map((f) => (
              // by role, not by picture: two roles can resolve to the same one
              <li key={f.label}>
                <button
                  type="button"
                  className="sc-refset-tile"
                  data-role={f.angle}
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
        ) : (
          <EmptyRefFrame />
        )}

        {owned && owned.sourceRefs.length > 0 && (
          <section className="sc-presenterpage-sources">
            <p className="sc-presenterpage-sources-lb">From your photos</p>
            <div className="sc-presenterpage-sources-row">
              {owned.sourceRefs.map((src, i) => (
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

        {/* What is left to say about the record is a footnote and one verb.
            It was a list of label and value, which needs more than two things
            in it to be a list; the line is a disclosure, not a field, and it
            says what is true about the record rather than lecturing about
            advertising law, which is not this page's job to teach. */}
        {owned && (
          <div className="sc-prec">
            <p className="sc-prec-note">
              {presenter.ageRange ? `${presenter.ageRange} \u00b7 ` : ''}
              {owned.source === 'synthetic'
                ? 'Created in Scenri. Not a real person.'
                : owned.source === 'photos'
                  ? 'Built from your photographs.'
                  : 'Saved in Scenri.'}
              {owned.likeness ? ` Likeness confirmed ${new Date(owned.likeness.attestedAt).toLocaleDateString()}.` : ''}
            </p>
            <Confirm
              label="Delete presenter"
              title={`Delete ${owned.name}?`}
              body="Shots already made with them keep their images and their recipe. Only future shots lose them."
              busy={busy}
              onConfirm={() => void remove()}
            />
          </div>
        )}

        {made.length > 0 && (
          <Slider label={`Shots featuring ${presenter.name}`}>
            {made.map((s) => (
              <ShotThumb key={s.id} node={s} to={shotPath(brand, null, s.id)} />
            ))}
          </Slider>
        )}

        {details && owned && (
          <AssetDetailsDialog
            name={owned.name}
            categories={presenter.suitableCategories}
            known={known}
            hint="The verticals they suit, so they surface where you work."
            busy={busy}
            error={err}
            onSave={(next) => void save({ name: next.name, suitableCategories: next.categories })}
            onDismiss={() => setDetails(false)}
          />
        )}

        {open && (
          <ImageLightbox
            src={open.src}
            kind="presenter"
            label={open.label}
            noun={presenter.name}
            onClose={() => setOpen(null)}
          />
        )}
      </main>
    </ScrollPane>
  );
}

/**
 * A picture the record points at that may not be there any more.
 *
 * A hash outlives its file: a library restored without its images, a record
 * older than a sweep. Every picture on this page drew the browser's own broken
 * glyph instead of saying so. The same fallback `RefFrame` uses, in this
 * page's markup.
 */
function Shown({ src, crop }: { src: string; crop?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken)
    return (
      <span className="sc-lookpage-ref-blank" aria-hidden>
        <ImageSquare size={20} />
      </span>
    );
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      {...(crop ? { 'data-crop': crop } : {})}
      onError={() => setBroken(true)}
    />
  );
}
