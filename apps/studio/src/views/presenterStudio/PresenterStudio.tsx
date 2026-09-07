import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, type AssetBuildCapabilities } from '../../api.js';
import { useAppData } from '../../app/AppShell.js';
import { useBrand } from '../../app/BrandLayout.js';
import { Confirm } from '../../Confirm.js';
import { ScrollPane } from '../../layout/ScrollPane.js';
import { hubPath, presenterDraftPath, presenterNewPath, presenterPath, presentersPath } from '../../routes.js';
import { useToasts } from '../../toasts.js';
import { useTitleEntity } from '../../useDocumentTitle.js';
import { StudioActions } from './StudioActions.js';
import { StudioEntry } from './StudioEntry.js';
import { StudioReview } from './StudioReview.js';
import { StudioStage } from './StudioStage.js';
import { ViewStrip } from './ViewStrip.js';
import {
  allApproved,
  currentView,
  nextToDraw,
  saveBlocker,
  stageCopy,
  stripItems,
  worthKeeping,
  type StudioView,
} from './studioRules.js';
import { usePresenterDraft } from './usePresenterDraft.js';

/**
 * The presenter studio. A page, not a dialog: a person is cast over several
 * generations with a big picture in front of you, the URL is the draft so a
 * reload resumes, and a phone gets a real layout rather than a squeezed one.
 *
 * Create the person, see them, approve them, build their views on that face,
 * name them, save. The image dominates every stage; the controls support it.
 */
export function PresenterStudio() {
  const { draftId } = useParams();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const location = useLocation();
  const { push } = useToasts();
  const { presenterCategories, applyBrand } = useAppData();
  useTitleEntity('Create presenter');

  // Asked once per visit: whether anything here can draw, and what it costs.
  const [caps, setCaps] = useState<AssetBuildCapabilities | null>(null);
  const [capsFailed, setCapsFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .assetBuildCapabilities()
      .then((c) => alive && setCaps(c))
      .catch(() => alive && setCapsFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  const capsNote = useCallback(
    (whenKnown: string) =>
      caps ? whenKnown : capsFailed ? 'Could not reach the engine. You can still try.' : 'Checking the engine…',
    [caps, capsFailed],
  );

  // Escape leaves the page. The draft stays on the server, to be continued.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      navigate(presentersPath(brand));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [brand, navigate]);

  if (!draftId) {
    return (
      <ScrollPane>
        <main className="sc-lookpage sc-studio" id="main">
          <div className="sc-lookpage-crumb">
            <Link to={presentersPath(brand)}>Presenters</Link>
            <span>/</span>
            <span>Create</span>
          </div>
          <StudioEntry
            brand={brand}
            caps={caps}
            capsNote={capsNote}
            onCreated={(d) => navigate(presenterDraftPath(brand, d.id), { replace: true, state: location.state })}
          />
        </main>
      </ScrollPane>
    );
  }

  return (
    <DraftStudio
      key={draftId}
      draftId={draftId}
      caps={caps}
      capsNote={capsNote}
      categories={presenterCategories}
      fromCompose={(location.state as any)?.from === 'compose'}
      onSaved={(presenter, brandNext) => {
        applyBrand(brandNext);
        push({
          kind: 'success',
          title: `${presenter.name} is ready`,
          actions: [
            {
              label: 'Use in a shot',
              onClick: () => navigate(`${hubPath(brand)}?presenter=${presenter.id}&compose=1`),
            },
          ],
        });
      }}
    />
  );
}

function DraftStudio({
  draftId,
  caps,
  capsNote,
  categories,
  fromCompose,
  onSaved,
}: {
  draftId: string;
  caps: AssetBuildCapabilities | null;
  capsNote: (whenKnown: string) => React.ReactNode;
  categories: string[];
  fromCompose: boolean;
  onSaved: (presenter: { id: string; name: string }, brand: any) => void;
}) {
  const { brand } = useBrand();
  const navigate = useNavigate();
  const s = usePresenterDraft(brand.id, draftId);
  const draft = s.draft;
  // A view the person clicked on in the strip, to look at again or redo.
  const [focus, setFocus] = useState<StudioView | null>(null);
  const [name, setName] = useState('');
  const [facets, setFacets] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const seeded = useRef(false);
  useEffect(() => {
    if (!draft || seeded.current) return;
    seeded.current = true;
    setName(draft.name);
    setFacets(draft.facets);
  }, [draft]);

  // The next empty view is drawn without a click, once per attempt: that is
  // what "Approve & continue" means, and what a fresh draft does on arrival.
  const started = useRef<string>('');
  useEffect(() => {
    if (!draft || s.busy) return;
    const view = nextToDraw(draft);
    if (!view) return;
    const key = `${view}:${draft.views[view].attempts}:${draft.generations}`;
    if (started.current === key) return;
    started.current = key;
    void s.generate(view);
  }, [draft, s.busy, s.generate]);

  // The name is written as it is typed, debounced, so a reload keeps it.
  const nameTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setNameLater = (next: string) => {
    setName(next);
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => void s.update({ name: next }), 500);
  };
  const setFacetsNow = (next: string[]) => {
    setFacets(next);
    void s.update({ facets: next });
  };

  if (s.gone) {
    return (
      <ScrollPane>
        <main className="sc-lookpage sc-studio" id="main">
          <h1>This draft is gone</h1>
          <p className="sc-lookpage-lede">It was saved or discarded. Start another whenever you like.</p>
          <div className="sc-lookpage-acts">
            <Link className="sc-btn sc-btn-primary" to={presenterNewPath(brand)}>
              Create a presenter
            </Link>
          </div>
        </main>
      </ScrollPane>
    );
  }
  if (!draft) {
    return (
      <ScrollPane>
        <main className="sc-lookpage sc-studio" id="main">
          <div className="sc-tplrow" aria-hidden />
        </main>
      </ScrollPane>
    );
  }

  const current = currentView(draft);
  const review = allApproved(draft) && !focus;
  const view: StudioView = focus ?? current ?? 'portrait';
  const slot = draft.views[view];
  const drawing = draft.activeView === view || (draft.stage !== 'idle' && !focus);
  const copy = stageCopy(view, slot, draft.source, drawing ? draft.stage : 'idle');
  const isCurrent = view === current;
  const blocker = saveBlocker(draft, name);

  const save = async () => {
    setSaving(true);
    try {
      if (nameTimer.current) clearTimeout(nameTimer.current);
      await api.updatePresenterDraft(brand.id, draft.id, { name, facets });
      const r = await api.savePresenterDraft(brand.id, draft.id);
      onSaved(r.presenter, r.brand);
      navigate(
        fromCompose ? `${hubPath(brand)}?presenter=${r.presenter.id}&compose=1` : presenterPath(brand, r.presenter.id),
        {
          replace: true,
        },
      );
    } catch (e: any) {
      s.clearErr();
      setSaving(false);
      push_(e);
    }
  };
  const push_ = (e: any) => {
    // the hook's own error line carries it; nothing else to do here
    void e;
  };
  const discard = async () => {
    setDiscarding(true);
    try {
      await api.deletePresenterDraft(brand.id, draft.id);
      navigate(presentersPath(brand), { replace: true });
    } catch {
      setDiscarding(false);
    }
  };

  return (
    <ScrollPane>
      <main className="sc-lookpage sc-studio" id="main" data-review={review || undefined}>
        <div className="sc-studio-head">
          <div className="sc-lookpage-crumb">
            <Link to={presentersPath(brand)}>Presenters</Link>
            <span>/</span>
            <span>Create</span>
          </div>
          {worthKeeping(draft) ? (
            <Confirm
              label="Discard"
              title="Discard this presenter?"
              body="The views drawn so far are thrown away. Nothing was saved to the library."
              busy={discarding}
              onConfirm={() => void discard()}
            />
          ) : (
            <button type="button" className="sc-btn sc-btn-ghost" disabled={discarding} onClick={() => void discard()}>
              Discard
            </button>
          )}
        </div>

        {review ? (
          <>
            <ViewStrip items={stripItems(draft, focus)} onPick={(v) => setFocus(v)} />
            <StudioReview
              draft={draft}
              categories={categories}
              name={name}
              facets={facets}
              blocker={blocker}
              busy={saving}
              onName={setNameLater}
              onFacets={setFacetsNow}
              onSave={() => void save()}
            />
          </>
        ) : (
          <div className="sc-studio-body">
            <StudioStage view={view} slot={slot} drawing={drawing} since={draft.updatedAt} name={name} />
            <aside className="sc-studio-rail">
              <ViewStrip items={stripItems(draft, focus)} onPick={(v) => setFocus(v)} />
              <div className="sc-studio-step" role="status" aria-live="polite">
                <h2>{copy.title}</h2>
                <p>{copy.hint}</p>
                {s.err && <p className="sc-studio-blocker">{s.err}</p>}
              </div>
              <StudioActions
                view={view}
                slot={slot}
                isCurrent={isCurrent}
                busy={s.busy || saving}
                lastStep={view === 'three-quarter'}
                onApprove={() => {
                  void s.approve(view);
                  setFocus(null);
                }}
                onAgain={() => void s.generate(view)}
                onAdjust={(a) => void s.generate(view, a)}
                onRedo={() => {
                  void s.redo(view);
                  setFocus(null);
                }}
                onBack={() => setFocus(null)}
              />
              <p className="sc-studio-foot">
                {capsNote(caps?.free ? 'Nothing billed through Scenri.' : 'Each view is one generation.')}
              </p>
            </aside>
          </div>
        )}
      </main>
    </ScrollPane>
  );
}
