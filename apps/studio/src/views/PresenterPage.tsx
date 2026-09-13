import { PencilSimple } from '@phosphor-icons/react';
import { type CSSProperties, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { api, type PresenterPatch, thumbOf } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useMadeWith } from './useMadeWith.js';
import { useTitleEntity } from '../useDocumentTitle.js';
import { customPresenterById, headPresenterId } from '../brandAssets.js';
import { presenterAvatar } from '../presenterVisual.js';
import { presenterEditPath, presenterPath, presentersPath, shotPath } from '../routes.js';
import { useApplyPresenter } from '../app/useApplyPresenter.js';
import { Confirm } from '../Confirm.js';
import { ImageLightbox } from '../composer/ImageLightbox.js';
import { Tip } from '../layout/Tip.js';
import { EmptyRefFrame, ShotThumb, Slider } from '../layout/ReferenceGallery.js';
import { ScrollPane } from '../layout/ScrollPane.js';
import { PresenterDetailsDialog } from './PresenterDetailsDialog.js';

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
/** A curated presenter's frames arrive in this order, with no angle on them. */
const CURATED_LABELS = ['Front', 'Left', 'Right', 'Back'];

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
  const { presenters, presentersLoaded, presentersError, refetchPresenters, applyBrand, presenterCategories } =
    useAppData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const applyPresenter = useApplyPresenter();
  const [refs, setRefs] = useState<string[]>([]);
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

  // An edit session under way for this person is offered back, never shown as them.
  useEffect(() => {
    let alive = true;
    setEditing(null);
    if (!isOwned) return;
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
  }, [brand.id, presenterId, isOwned]);

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
    if (!owned) return;
    setBusy(true);
    try {
      await api.deletePresenter(brand.id, owned.id);
      navigate(presentersPath(brand));
    } catch (e: any) {
      setErr(String(e.message ?? e));
      setBusy(false);
    }
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

  // The reference set, each picture with the role the record gives it.
  const angles: (string | undefined)[] = Array.isArray(record?.shots) ? record.shots.map((s: any) => s?.angle) : [];
  const frames: { src: string; label: string }[] = owned
    ? (owned.shots ?? []).map((src, i) => ({ src, label: ROLE_LABEL[angles[i] ?? ''] ?? `Reference ${i + 1}` }))
    : refs.length
      ? refs.map((src, i) => ({ src, label: CURATED_LABELS[i] ?? `Reference ${i + 1}` }))
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
  const facts = presenter.ageRange ?? '';
  // A face, at face size. `presenterVisual` is the one chain that answers
  // "what goes in a presenter's circle": the purpose-built square head crop
  // when the record has one, and a `crop` hint when it had to fall back to a
  // picture framed for something else. Both of these records carry a real
  // avatar, so the circle is a real face rather than a torso squeezed round.
  const face = presenterAvatar(owned ?? presenter);

  return (
    <ScrollPane>
      <main className="sc-lookpage sc-presenterpage" id="main">
        <div className="sc-lookpage-crumb">
          <Link to={presentersPath(brand)}>Presenters</Link>
          <span>/</span>
          <span>{owned ? 'Yours' : (presenter.suitableStyles[0] ?? presenter.presentation)}</span>
        </div>

        {face.src && (
          <div className="sc-presenterpage-avatar">
            <img src={thumbOf(face.src, 'small')} alt="" data-crop={face.crop} />
          </div>
        )}

        <h1>{presenter.name}</h1>
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
            way a turnaround is drawn. Nothing is cropped to make them match:
            the frames are 4:5 already, and a legacy or curated one that is
            not letterboxes rather than losing its feet. */}
        {frames.length > 0 ? (
          <ol
            className="sc-refset"
            aria-label="Reference set"
            data-count={frames.length}
            style={{ '--sc-refset-n': frames.length } as CSSProperties}
          >
            {frames.map((f) => (
              <li key={f.src}>
                <button
                  type="button"
                  className="sc-refset-tile"
                  aria-label={`${f.label}, open`}
                  onClick={() => setOpen(f)}
                >
                  <img src={thumbOf(f.src, 'small')} alt="" loading="lazy" decoding="async" />
                </button>
                <span className="sc-refset-lb" aria-hidden>
                  {f.label}
                </span>
              </li>
            ))}
          </ol>
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
                  <img src={thumbOf(src, 'micro')} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* The record, under the pictures it describes. A label and a value
            per line, left aligned the way the other look pages set their owned
            block: age and filing used to be two more centred grey rows above
            the actions, where they competed with the name for the same
            attention and gave the page no base at all. */}
        <dl className="sc-prec">
          {facts && (
            <>
              <dt>Age</dt>
              <dd>{facts}</dd>
            </>
          )}
          {presenter.suitableCategories.length > 0 && (
            <>
              <dt>Filed under</dt>
              <dd>{presenter.suitableCategories.join(', ')}</dd>
            </>
          )}
          {owned && (
            <>
              <dt>Origin</dt>
              {/* Where they came from is kept, never inferred: a person made
                  from a description is not a real person, and an advertiser
                  has to say so where the law asks. */}
              <dd>
                {owned.source === 'synthetic'
                  ? 'Created in Scenri from a description. Not a real person. Ads that use them must say so where the law asks.'
                  : owned.source === 'photos'
                    ? 'Built from photographs you provided.'
                    : 'Saved in Scenri.'}
                {owned.likeness
                  ? ` Likeness permission confirmed ${new Date(owned.likeness.attestedAt).toLocaleDateString()}.`
                  : ''}
              </dd>
            </>
          )}
        </dl>

        {owned && (
          <div className="sc-prec-manage">
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
          <PresenterDetailsDialog
            name={owned.name}
            descriptor={owned.descriptor ?? ''}
            categories={presenter.suitableCategories}
            known={presenterCategories}
            busy={busy}
            error={err}
            onSave={(next) => void save(next)}
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
