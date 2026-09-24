import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { matchPath, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import type { Brand, HeroWith, SceneReading } from '../api.js';
import { customSceneById } from '../brandAssets.js';
import type { SavedScene } from '../create/scene/useSceneStudio.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useCreateFlow } from '../create/AssetCreateHost.js';
import { SceneCreate } from '../create/scene/SceneCreate.js';
import { seeded, type StudioState } from '../create/scene/sceneStudioRules.js';
import { COPY } from '../create/scene/sceneCopy.js';
import { P, sceneEditPath, scenePath, scenesPath, sceneStudioPath } from '../routes.js';
import { useTitleEntity } from '../useDocumentTitle.js';

const hashOf = (ref: unknown): string | null => {
  const m = /^asset:([a-f0-9]{32})$/.exec(String(ref ?? ''));
  return m ? m[1] : null;
};

/** A saved scene as the studio opens it: its words, its pictures and its picture, nothing spent. */
function seedFrom(brand: Brand, sceneId: string): StudioState | null {
  const rows = ((brand.json as any)?.scenes ?? []) as any[];
  const r = rows.find((s) => s?.id === sceneId);
  if (!r) return null;
  const reading: SceneReading = {
    name: String(r.name ?? ''),
    prompt: String(r.prompt ?? ''),
    lighting: String(r.lighting ?? ''),
    subject: r.subject === 'product' || r.subject === 'person' ? r.subject : 'either',
    description: String(r.description ?? ''),
    ...(r.promptName ? { promptName: String(r.promptName) } : {}),
    ...(r.camera ? { camera: String(r.camera) } : {}),
    ...(r.figure ? { figure: String(r.figure) } : {}),
    ...(r.figure && r.figureTreatment ? { figureTreatment: String(r.figureTreatment) } : {}),
    ...(Array.isArray(r.keywords) ? { keywords: r.keywords.map(String) } : {}),
    ...(Array.isArray(r.collections) ? { collections: r.collections.map(String) } : {}),
    ...(Array.isArray(r.verticals) ? { verticals: r.verticals.map(String) } : {}),
  };
  const pictures = (Array.isArray(r.refs) ? r.refs : []).map((x: any) => hashOf(x?.file)).filter(Boolean) as string[];
  return seeded({
    place: String(r.instruction ?? ''),
    // a scene saved from elsewhere may hold up to eight: the studio reads from
    // four and keeps the rest (seeded splits them)
    pictures,
    reading,
    hash: hashOf(r.preview) ?? null,
    anchor: r.anchor === true,
    // its hero, when one is drawn from this very picture: shown first, as it was made
    ...heroOf(r),
    name: reading.name,
  });
}

/** A saved scene's hero, when it was drawn from the picture the scene wears now. */
function heroOf(r: any): { hero?: string; heroWith?: HeroWith } {
  const e = (Array.isArray(r.examples) ? r.examples : []).find((x: any) => x?.role === 'hero' && x?.from === r.preview);
  const hero = hashOf(e?.file);
  if (!hero) return {};
  const heroWith: HeroWith = {
    ...(e.product ? { product: String(e.product) } : {}),
    ...(e.presenter ? { presenter: String(e.presenter) } : {}),
  };
  return { hero, heroWith };
}

/** A conversation's name in the URL. Not `randomUUID`: a lane opened over the LAN is not a secure context. */
function mintConversation(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The scene studio as a URL: `/scenes/new/:convoId` for a new scene, and
 * `/scenes/:sceneId/edit/:convoId` for one that exists.
 *
 * A child route of the library (or of the scene's page), so leaving is instant
 * and comes back to the same scroll. Pressing Create scene arrives without a
 * conversation and is given a new one, written into the address at once: the
 * work started in it runs on the server whatever the page does, and Back, a
 * reload or a row in Activity lands on the same conversation, its answers and
 * its pictures. Opened from Create, a saved scene goes back there in the brief,
 * the way Use in a shot does from its page.
 */
export function SceneStudioRoute() {
  const { sceneId = null, convoId = null } = useParams();
  const { key, state } = useLocation();
  const { brand } = useBrand();
  const { applyBrand } = useAppData();
  const navigate = useNavigate();
  const { announce, caps } = useCreateFlow();
  useTitleEntity(sceneId ? 'Edit scene' : 'Create scene');

  // Read once, on the way in: the record is the version the session starts
  // from, and a brand refetch while editing must not reseed underneath it.
  const [seed] = useState<StudioState | null>(() => (sceneId ? seedFrom(brand, sceneId) : null));
  const from = typeof (state as any)?.from === 'string' ? ((state as any).from as string) : null;
  const toCreate = from && (matchPath(P.hub, from.split('?')[0]) || matchPath(P.set, from.split('?')[0]));

  const close = useCallback(
    () => navigate(from ?? (sceneId ? scenePath(brand, sceneId) : scenesPath(brand)), { replace: true }),
    [navigate, from, sceneId, brand],
  );

  // Minted per arrival, then kept by the address: the replace below changes the
  // history entry's key, and the memo then reads the same id back from the URL.
  const convo = useMemo(() => convoId ?? mintConversation(), [convoId, key]);
  useEffect(() => {
    if (convoId || (sceneId && !seed)) return;
    navigate(sceneId ? sceneEditPath(brand, sceneId, convo) : sceneStudioPath(brand, convo), { replace: true, state });
  }, [convoId, convo, sceneId, seed, brand, navigate, state]);

  /** What Use saved, said to the app once the conversation is over (a reload finds it in the brand). */
  const saved = useRef<{ made: SavedScene; how: 'created' | 'updated' } | null>(null);

  // a catalog scene has no record here to edit, and a gone one has nothing at all
  if (sceneId && !seed) return <Navigate to={scenePath(brand, sceneId)} replace />;

  return (
    <SceneCreate
      key={convo}
      brand={brand}
      applyBrand={applyBrand}
      sceneId={sceneId}
      seed={seed}
      conversation={convo}
      storageKey={`scenri:scene-studio:${brand.id}:${convo}`}
      caps={caps ? { canRead: caps.canAnalyze, canDraw: caps.canGenerate } : null}
      onClose={close}
      // an address with no conversation in it is a new one, the way Create presenter is
      onStartOver={() => navigate(sceneStudioPath(brand), { replace: true, state })}
      // Use saves and the conversation goes on to the place in use, which says
      // "Saved" itself; the card that says so to the rest of the app, and the
      // way out, wait for the last press: back into the brief it was opened
      // from, or the scene's page. Where Use alone used to lead.
      onSaved={(made, how) => {
        saved.current = { made, how };
      }}
      finish={toCreate ? COPY.useInAShot : COPY.openScene}
      onDone={(id, opts) => {
        // a scene taken as it already was (a shot's own) was not saved here, so nothing is announced
        if (!opts?.existing) {
          const row = customSceneById(brand, id);
          const made = saved.current?.made.id === id ? saved.current.made : null;
          announce({
            kind: 'scene',
            id,
            name: made?.name ?? row?.name ?? '',
            verticals: made?.verticals ?? row?.verticals ?? [],
            how: saved.current?.how ?? (sceneId === id ? 'updated' : 'created'),
          });
        }
        if (toCreate && from)
          navigate(`${from.split('?')[0]}?scene=${encodeURIComponent(id)}&compose=1`, { replace: true });
        else navigate(scenePath(brand, id), { replace: true });
      }}
    />
  );
}
