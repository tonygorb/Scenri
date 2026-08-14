import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { TextArea, TextField } from '@radix-ui/themes';
import { api, type PresenterPatch } from '../api.js';
import { useAppData, useFilterParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { customPresenterById } from '../brandAssets.js';
import { presenterPath, presentersPath, shotPath } from '../routes.js';
import { useApplyPresenter } from '../app/useApplyPresenter.js';
import { Confirm } from '../Confirm.js';
import { PresenterCard } from '../layout/PresenterCard.js';
import { EmptyRefFrame, RefFrame, ShotThumb, Slider } from '../layout/ReferenceGallery.js';
import { ScrollPane } from '../layout/ScrollPane.js';

/** Every presenter ships exactly 4 frames (front/left/right/back), so this never triggers "See the whole set" — kept as a cap rather than a magic 4 in the slice call below in case a future presenter ships more. */
const FRONT_ANGLES = 4;

/**
 * One presenter. The reference set says who they are — face, profile, hair,
 * build — from the same controlled setup every time; it is ours and is
 * deliberately not clickable. Everything below is yours: what you have made
 * with them so far.
 */
export function PresenterPage() {
  const { presenterId = '' } = useParams();
  const { presenters, presentersLoaded, presentersError, refetchPresenters, applyBrand } = useAppData();
  const { brand, nodes: shots } = useBrand();
  const navigate = useNavigate();
  const applyPresenter = useApplyPresenter();
  const [refs, setRefs] = useState<string[]>([]);
  const [allParam, setOpenAll] = useFilterParam('all');
  const openAll = allParam === '1';

  // The brand's own people come before the catalog, the same order the
  // compiler resolves them in.
  const owned = customPresenterById(brand, presenterId);
  const presenter = owned ?? presenters.find((p) => p.id === presenterId);

  useEffect(() => {
    let alive = true;
    setRefs([]);
    // A person built here carries their views in the brand document; only a
    // curated one has frames sitting on disk to go and ask about.
    if (owned) return;
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
  }, [presenterId, owned]);

  // Older brands may still have a roster copy from before presenters attached
  // straight from the catalog — its shots used the copy's own id, not the
  // presenter's, so both are matched here to keep that history visible.
  const roster: any[] = (brand.json?.characters ?? []) as any[];
  const inRoster = roster.find((c) => c.presenterId === presenterId);

  /** Shots whose brief attached this presenter, directly or via an old roster copy. */
  const made = useMemo(
    () =>
      shots
        .filter(
          (s) =>
            s.status === 'done' &&
            s.images.length > 0 &&
            (s.brief?.tokens ?? []).some(
              (t: any) => t?.t === 'character' && (t.id === presenterId || t.id === inRoster?.id),
            ),
        )
        .slice(-12)
        .reverse(),
    [shots, presenterId, inRoster],
  );

  const [draftName, setDraftName] = useState(owned?.name ?? '');
  const [draftDescriptor, setDraftDescriptor] = useState(owned?.descriptor ?? '');
  const [draftIdentity, setDraftIdentity] = useState(owned?.identityNotes ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // Resync only on a different person, so a poll landing mid-keystroke
    // cannot overwrite what is being typed.
    setDraftName(owned?.name ?? '');
    setDraftDescriptor(owned?.descriptor ?? '');
    setDraftIdentity(owned?.identityNotes ?? '');
  }, [owned?.id]);

  /** Field edits are plain writes: nothing here costs a generation. */
  const patch = (next: PresenterPatch) => {
    if (!owned) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api
        .updatePresenter(brand.id, owned.id, next)
        .then((r) => applyBrand(r.brand))
        .catch((e: any) => setErr(String(e.message ?? e)));
    }, 500);
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
            <button type="button" className="sc-btn sc-btn-primary" onClick={() => navigate(presentersPath(brand))}>
              Browse presenters
            </button>
          </div>
        </main>
      </ScrollPane>
    );
  }

  const ownedFrames = owned?.shots ?? [];
  const visibleRefs = openAll ? refs : refs.slice(0, FRONT_ANGLES);
  const frames = owned ? ownedFrames : refs.length ? visibleRefs : presenter.previewUrl ? [presenter.previewUrl] : [];
  const others = presenters.filter((p) => p.id !== presenter.id).slice(0, 8);
  // A real square portrait needs no cropping trickery; the 4:5 fallback still does.
  const hasAvatar = Boolean(presenter.avatarUrl);
  const avatarSrc = presenter.avatarUrl ?? presenter.previewUrl ?? refs[0] ?? null;

  return (
    <ScrollPane>
      <main className="sc-lookpage sc-presenterpage" id="main">
        <div className="sc-lookpage-crumb">
          <button type="button" onClick={() => navigate(presentersPath(brand))}>
            Presenters
          </button>
          <span>/</span>
          <span>{owned ? 'Yours' : (presenter.suitableStyles[0] ?? presenter.presentation)}</span>
        </div>

        {avatarSrc ? (
          <div className="sc-presenterpage-avatar" data-avatar={hasAvatar || undefined} aria-hidden>
            <img src={avatarSrc} alt="" />
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
          />
        ) : (
          <p className="sc-lookpage-lede">{presenter.descriptor}</p>
        )}
        <p className="sc-lookpage-facts">
          {[presenter.ageRange, presenter.hair, presenter.suitableCategories.join(', ')].filter(Boolean).join(' · ')}
        </p>
        <div className="sc-lookpage-acts">
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => applyPresenter(presenterId)}>
            Use in a shot
          </button>
        </div>
        {err && <p className="sc-assetform-err">{err}</p>}

        {frames.length > 0 ? (
          <>
            <div className="sc-lookpage-refs">
              {frames.map((src, i) => (
                <div key={src} className="sc-ownedref" data-engine={owned && i < 2 ? '' : undefined}>
                  <RefFrame src={src} />
                  {/* Two references per person reach the engine, and they are
                      the first two. Saying which is the difference between a
                      gallery and knowing what your shots are built from. */}
                  {owned && i < 2 && <span className="sc-ownedref-tag">Used in shots</span>}
                </div>
              ))}
            </div>
            {!owned && refs.length > FRONT_ANGLES && (
              <button type="button" className="sc-lookpage-expand" onClick={() => setOpenAll(openAll ? null : '1')}>
                {openAll ? 'Enough, close it' : 'See the whole set'}
              </button>
            )}
          </>
        ) : (
          <EmptyRefFrame />
        )}

        {owned && (
          <div className="sc-ownedbits">
            {owned.sourceRefs.length > 0 && (
              <section>
                <p className="sc-bandhead">Your photos</p>
                <p className="sc-ownedbits-note">
                  What this presenter was built from. Kept as they arrived, and never replaced by anything generated.
                </p>
                <div className="sc-lookpage-refs">
                  {owned.sourceRefs.map((src) => (
                    <RefFrame key={src} src={src} />
                  ))}
                </div>
              </section>
            )}

            <section>
              <p className="sc-bandhead">What must stay the same</p>
              <p className="sc-ownedbits-note">Sent with every shot they appear in.</p>
              <TextArea
                value={draftIdentity}
                rows={3}
                placeholder="For example: the wide-set eyes and the small scar above the left brow must survive every generation."
                onChange={(e) => {
                  setDraftIdentity(e.target.value);
                  patch({ identityNotes: e.target.value });
                }}
              />
              {owned.negativeConstraints.length > 0 && (
                <ul className="sc-ownedbits-list">
                  {owned.negativeConstraints.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </section>

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
              <ShotThumb key={s.id} node={s} onClick={() => navigate(shotPath(brand, null, s.id))} />
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
              />
            ))}
          </Slider>
        )}
      </main>
    </ScrollPane>
  );
}
