import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { TextField } from '@radix-ui/themes';
import { api, type PresenterPatch } from '../api.js';
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
import { PresenterCard } from '../layout/PresenterCard.js';
import { EmptyRefFrame, ShotThumb, Slider } from '../layout/ReferenceGallery.js';
import { ScrollPane } from '../layout/ScrollPane.js';

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
  const { presenters, presentersLoaded, presentersError, refetchPresenters, applyBrand } = useAppData();
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

  const [draftName, setDraftName] = useState(owned?.name ?? '');
  const [draftDescriptor, setDraftDescriptor] = useState(owned?.descriptor ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<PresenterPatch | null>(null);

  useEffect(() => {
    // Resync only on a different person, so a poll landing mid-keystroke
    // cannot overwrite what is being typed.
    setDraftName(owned?.name ?? '');
    setDraftDescriptor(owned?.descriptor ?? '');
  }, [owned?.id]);

  /** Words only: nothing here costs a generation. Debounced, and flushed when the page is left. */
  const flush = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const next = pending.current;
    pending.current = null;
    if (!next || !owned) return;
    void api
      .updatePresenter(brand.id, owned.id, next)
      .then((r) => applyBrand(r.brand))
      .catch((e: any) => setErr(String(e.message ?? e)));
  };
  const patch = (next: PresenterPatch) => {
    if (!owned) return;
    pending.current = { ...pending.current, ...next };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 500);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

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
  const others = presenters.filter((p) => p.id !== presenter.id).slice(0, 8);
  const heroAv = presenterAvatar(owned ?? presenter);
  const hasAvatar = Boolean(heroAv.src && !heroAv.crop);
  const avatarSrc = heroAv.src ?? refs[0] ?? null;
  const identityNotes = owned?.identityNotes?.trim() ?? '';

  return (
    <ScrollPane>
      <main className="sc-lookpage sc-presenterpage" id="main">
        <div className="sc-lookpage-crumb">
          <Link to={presentersPath(brand)}>Presenters</Link>
          <span>/</span>
          <span>{owned ? 'Yours' : (presenter.suitableStyles[0] ?? presenter.presentation)}</span>
        </div>

        {avatarSrc ? (
          <div className="sc-presenterpage-avatar" data-avatar={hasAvatar || undefined}>
            <img src={avatarSrc} alt={presenter.name} />
          </div>
        ) : null}

        {owned ? (
          <TextField.Root
            className="sc-ownededit-title"
            value={draftName}
            aria-label="Their name"
            onChange={(e) => {
              setDraftName(e.target.value);
              patch({ name: e.target.value });
            }}
            onBlur={flush}
          />
        ) : (
          <h1>{presenter.name}</h1>
        )}
        {owned ? (
          <TextField.Root
            className="sc-ownededit-lede"
            value={draftDescriptor}
            placeholder="A short caption for the card"
            aria-label="Caption"
            onChange={(e) => {
              setDraftDescriptor(e.target.value);
              patch({ descriptor: e.target.value });
            }}
            onBlur={flush}
          />
        ) : (
          <p className="sc-lookpage-lede">{presenter.descriptor}</p>
        )}
        <p className="sc-lookpage-facts">
          {[presenter.ageRange, presenter.hair, presenter.suitableCategories.join(', ')].filter(Boolean).join(' · ')}
        </p>

        {owned && editing && (
          <div className="sc-presenterpage-cont">
            <span>An edit is under way.</span>
            <Link className="sc-btn sc-btn-ghost" to={presenterEditPath(brand, presenterId)}>
              Continue editing
            </Link>
          </div>
        )}

        <div className="sc-lookpage-acts">
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => applyPresenter(presenterId)}>
            Use in a shot
          </button>
          {owned && (
            <Link className="sc-btn sc-btn-ghost" to={presenterEditPath(brand, presenterId)}>
              Edit presenter
            </Link>
          )}
        </div>
        {err && <p className="sc-assetform-err">{err}</p>}

        {frames.length > 0 ? (
          <ol className="sc-refset" aria-label="Reference set" data-count={frames.length}>
            {frames.map((f) => (
              <li key={f.src}>
                <button
                  type="button"
                  className="sc-refset-tile"
                  aria-label={`${f.label}, open`}
                  onClick={() => setOpen(f)}
                >
                  <img src={f.src} alt="" loading="lazy" decoding="async" />
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

        {owned && (
          <div className="sc-ownedbits sc-presenterpage-bits">
            {owned.sourceRefs.length > 0 && (
              <section className="sc-presenterpage-sources">
                <p className="sc-bandhead">Source photos</p>
                <div className="sc-presenterpage-sources-row">
                  {owned.sourceRefs.map((src, i) => (
                    <button
                      key={src}
                      type="button"
                      className="sc-refset-tile"
                      aria-label={`Source photo ${i + 1}, open`}
                      onClick={() => setOpen({ src, label: `Source photo ${i + 1}` })}
                    >
                      <img src={src} alt="" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              </section>
            )}
            {identityNotes && (
              <p className="sc-ownedbits-note">
                <b>Kept the same in every shot:</b> {identityNotes}
              </p>
            )}
            {/* Where they came from is kept, never inferred: a person made
                from a description is not a real person, and an advertiser
                has to say so where the law asks. */}
            {owned.source === 'synthetic' && (
              <p className="sc-ownedbits-note">
                Created in Scenri from a description. Not a real person. Ads that use them must say so where the law
                asks.
              </p>
            )}
            {owned.likeness && (
              <p className="sc-ownedbits-note">
                Likeness permission confirmed {new Date(owned.likeness.attestedAt).toLocaleDateString()}.
              </p>
            )}
            <div className="sc-lookpage-acts">
              <Confirm
                label="Delete presenter"
                title={`Delete ${owned.name}?`}
                body="Shots already made with them keep their images and their recipe. Only future shots lose them."
                busy={busy}
                onConfirm={() => void remove()}
              />
            </div>
          </div>
        )}

        {made.length > 0 && (
          <Slider label={`Shots featuring ${presenter.name}`}>
            {made.map((s) => (
              <ShotThumb key={s.id} node={s} to={shotPath(brand, null, s.id)} />
            ))}
          </Slider>
        )}

        {others.length > 0 && (
          <Slider label="Other presenters">
            {others.map((p) => (
              <PresenterCard
                key={p.id}
                presenter={p}
                variant="navigate"
                size="slider"
                onOpen={(id) => navigate(presenterPath(brand, id))}
                href={presenterPath(brand, p.id)}
              />
            ))}
          </Slider>
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
