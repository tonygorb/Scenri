import { useCallback, useState } from 'react';
import { matchPath, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import type { Brand, SceneReading } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useCreateFlow } from '../create/AssetCreateHost.js';
import { SceneStudio } from '../create/scene/SceneStudio.js';
import { seeded, type StudioState } from '../create/scene/sceneStudioRules.js';
import { P, scenePath, scenesPath } from '../routes.js';
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
    // a scene saved from elsewhere may hold up to eight; the studio reads from four
    pictures: pictures.slice(0, 4),
    reading,
    hash: hashOf(r.preview) ?? null,
    name: reading.name,
  });
}

/**
 * The scene studio as a URL: `/scenes/new` for a new scene, and
 * `/scenes/:sceneId/edit` for one that exists.
 *
 * A child route of the library (or of the scene's page), so leaving is instant
 * and comes back to the same scroll. `/scenes/new` is a new conversation every
 * time, named by the history entry it is had in: a reload keeps it, a new
 * press starts another. Opened from Create, a saved scene goes back there in
 * the brief, the way Use in a shot does from its page.
 */
export function SceneStudioRoute() {
  const { sceneId = null } = useParams();
  const { key, state } = useLocation();
  const { brand } = useBrand();
  const { applyBrand } = useAppData();
  const navigate = useNavigate();
  const { announce, caps, capsNote } = useCreateFlow();
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

  // a catalog scene has no record here to edit, and a gone one has nothing at all
  if (sceneId && !seed) return <Navigate to={scenePath(brand, sceneId)} replace />;

  return (
    <SceneStudio
      key={key}
      brand={brand}
      applyBrand={applyBrand}
      sceneId={sceneId}
      seed={seed}
      storageKey={`scenri:scene-studio:${brand.id}:${sceneId ?? 'new'}:${key}`}
      caps={caps ? { canRead: caps.canAnalyze, canDraw: caps.canGenerate } : null}
      capsNote={capsNote}
      onClose={close}
      onSaved={(made, how) => {
        announce({ kind: 'scene', id: made.id, name: made.name, verticals: made.verticals, how });
        if (toCreate && from)
          navigate(`${from.split('?')[0]}?scene=${encodeURIComponent(made.id)}&compose=1`, { replace: true });
        else navigate(scenePath(brand, made.id), { replace: true });
      }}
    />
  );
}
