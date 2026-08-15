import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { matchPath, useLocation, useParams } from 'react-router';
// `?inline` hands the stylesheet over as a string rather than as a side
// effect. A plain CSS import is extracted by the bundler even when the code
// that imported it is tree-shaken, so the public build ended up carrying the
// rules for a UI it does not have. As a string it is ordinary JS and drops
// with the rest of the layer.
import css from './feedback.css?inline';
import { PickerLayer } from './PickerLayer.js';
import { ComposerPopover } from './ComposerPopover.js';
import { ContextLayer, nativeMenuMatters } from './ContextLayer.js';
import { imageIndex, resolveNode, resolveTarget } from './resolve.js';
import { readEnvironment } from './env.js';
import { recentErrors } from './errors.js';
import { buildReport } from './payload.js';
import { P } from '../routes.js';
import type { Report, RouteContext, ScenriIds, TargetIdentity } from './types.js';

/**
 * Owns the two-step interaction: pick a thing, then say what is wrong with it.
 *
 * The picker exists because right-click was already taken. Canvas.tsx and
 * CatalogCard.tsx both mount a Radix ContextMenu on exactly the surfaces a
 * tester most wants to report, and a global contextmenu handler would either
 * fight them or destroy "save image" on a generated shot. Those two menus each
 * gained a "Report this" item instead, which is the fast path; this is the
 * one that works everywhere, including touch, where there is no right-click at
 * all and long-press already belongs to the browser.
 */

interface FeedbackApi {
  /** Enter picker mode. */
  start: () => void;
  /** Report a specific shot without picking, for the context-menu path. */
  reportNode: (nodeId: string) => void;
  reportFbId: (fbId: string) => void;
  active: boolean;
}

const Ctx = createContext<FeedbackApi>({
  start: () => {},
  reportNode: () => {},
  reportFbId: () => {},
  active: false,
});

export const useFeedback = (): FeedbackApi => useContext(Ctx);

/** Shot rows, so an image hash can be traced back to the run that made it. */
export interface FeedbackNode {
  id: string;
  images: string[];
  status?: string;
  error?: string | null;
  prompt?: string;
  brief?: unknown;
}

interface Props {
  children: ReactNode;
  brandId: string | null;
  brandSlug: string | null;
  projectId: string | null;
  nodes: FeedbackNode[];
  /** Ids that ship in templates/, so the report can say which are yours. */
  curatedSceneIds: ReadonlySet<string>;
  curatedPresenterIds: ReadonlySet<string>;
}

/** Route patterns, longest first, so `/create/shots/:id` beats `/create`. */
const PATTERNS = Object.values(P)
  .filter((p) => p !== '*' && p !== '/b/*')
  .sort((a, b) => b.length - a.length);

export function FeedbackProvider(props: Props) {
  const { children } = props;
  useStyles();
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<{ el: Element; target: TargetIdentity } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: Element } | null>(null);
  const location = useLocation();
  const params = useParams();

  // matchPath, not useMatch: a hook cannot be called per pattern, and the
  // route shape is what a report should name -- never a parsed pathname.
  const pattern = useMemo(() => PATTERNS.find((p) => matchPath(p, location.pathname)) ?? null, [location.pathname]);

  const byHash = useMemo(() => imageIndex(props.nodes), [props.nodes]);

  const pick = useCallback((el: Element) => {
    setPending({ el, target: resolveTarget(el) });
    setPicking(false);
  }, []);

  const start = useCallback(() => {
    setPending(null);
    setPicking(true);
  }, []);

  /** The context-menu path: we know the node, so skip the picker entirely. */
  const reportSelector = useCallback(
    (sel: string) => {
      const el = document.querySelector(sel);
      if (el) pick(el);
      else start();
    },
    [pick, start],
  );

  const reportNode = useCallback(
    (nodeId: string) => {
      reportSelector(`[data-fb-node="${CSS.escape(nodeId)}"]`);
    },
    [reportSelector],
  );

  const reportFbId = useCallback(
    (fbId: string) => {
      reportSelector(`[data-fb-id="${CSS.escape(fbId)}"]`);
    },
    [reportSelector],
  );

  // Canvas.tsx and CatalogCard.tsx dispatch an event rather than importing
  // this module, so no shipped component holds an import edge into the
  // feedback layer that could survive into the public bundle.
  useEffect(() => {
    const onEvent = (e: Event) => {
      const d = (e as CustomEvent<{ nodeId?: string; fbId?: string }>).detail;
      if (d?.nodeId) reportNode(d.nodeId);
      else if (d?.fbId) reportFbId(d.fbId);
      else start();
    };
    window.addEventListener('scenri:feedback', onEvent);
    return () => window.removeEventListener('scenri:feedback', onEvent);
  }, [reportNode, reportFbId, start]);

  /*
   * Right-click is the way in, so there is no standing button in the chrome.
   *
   * Three ways this stands down, in order. `defaultPrevented` means a more
   * specific menu already claimed the event — Canvas.tsx and CatalogCard.tsx
   * both mount a Radix ContextMenu, and theirs is richer than this one.
   * `nativeMenuMatters` means the browser's own menu carries something no page
   * can reproduce: the caret, paste, spellcheck. Everything else is ours, and
   * where it takes over an image it offers copy and save itself.
   */
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (nativeMenuMatters(e.target)) return;
      const el = e.target as Element | null;
      if (!el || el === document.documentElement || el === document.body) return;
      e.preventDefault();
      setPending(null);
      setPicking(false);
      setMenu({ x: e.clientX, y: e.clientY, target: el });
    };
    // bubble phase, so Radix has already had its say and set defaultPrevented
    window.addEventListener('contextmenu', onMenu);
    return () => window.removeEventListener('contextmenu', onMenu);
  }, []);

  // ⇧F, bound here rather than in Shortcuts.tsx: that dialog and its key
  // handling live in views/Create.tsx, which renders on 2 of 11 routes, so a
  // binding there would be dead everywhere else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'F') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      e.preventDefault();
      start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);

  const makeReport = useCallback(
    (comment: string, target: TargetIdentity): Report => {
      const { nodeId, variant } = resolveNode(target, byHash);
      const node = nodeId ? props.nodes.find((n) => n.id === nodeId) : undefined;
      const search: Record<string, string> = {};
      new URLSearchParams(location.search).forEach((v, k) => {
        if (k !== 't') search[k] = v;
      });

      const route: RouteContext = {
        pattern,
        params: params as Record<string, string>,
        path: location.pathname + location.search,
        search,
        dialog: search.settings ?? null,
      };

      // The recipe that produced this shot, which is what makes the report
      // reproducible: a scene id like `interiors-marble-kitchen-counter` is a
      // file the owner already has, so they can rebuild the shot rather than
      // ask what it was. Read from the stored brief, not from the composer —
      // Composer.tsx keeps its sentence in local useState and no sibling can
      // see it.
      const tokens = brieftokens(node?.brief);
      const tokenIds = (t: string) =>
        tokens
          .filter((x) => x.t === t)
          .map((x) => x.id)
          .filter(Boolean) as string[];
      const sceneIds = tokenIds('template');
      const presenterIds = tokenIds('character');
      const productIds = tokenIds('product');
      const curatedOf = (list: string[], known: ReadonlySet<string>) =>
        known.size ? list.filter((id) => known.has(id)) : list.filter((id) => !UUIDISH.test(id));
      const localOf = (list: string[], known: ReadonlySet<string>) =>
        known.size ? list.filter((id) => !known.has(id)) : list.filter((id) => UUIDISH.test(id));

      const ids: ScenriIds = {
        curated: {
          sceneIds: curatedOf(sceneIds, props.curatedSceneIds),
          presenterIds: curatedOf(presenterIds, props.curatedPresenterIds),
          demoProductIds: [],
          engineId: readPref('scenri:engine'),
          engineAvailable: null,
          engineReason: null,
          quality: readPref('scenri:quality'),
          format: readPref('scenri:format'),
          count: Number(readPref('scenri:count')) || null,
        },
        local: {
          brandId: props.brandId,
          brandSlug: props.brandSlug,
          projectId: props.projectId,
          nodeId,
          variant,
          imageHash: target.imageHash,
          // brand-library products are UUIDs; the curated demo ones are slugs
          productIds,
          customSceneIds: localOf(sceneIds, props.curatedSceneIds),
          customPresenterIds: localOf(presenterIds, props.curatedPresenterIds),
          setSlug: (params as Record<string, string>).setSlug ?? null,
        },
        prompt: node?.prompt ?? null,
        nodeStatus: node?.status ?? null,
        nodeError: node?.error ?? null,
      };

      return buildReport({
        id: `fb_${Math.random().toString(36).slice(2, 10)}`,
        comment,
        target,
        route,
        ids,
        env: readEnvironment(),
        errors: recentErrors(),
      });
    },
    [byHash, location, params, pattern, props],
  );

  const api = useMemo<FeedbackApi>(
    () => ({ start, reportNode, reportFbId, active: picking || pending !== null }),
    [start, reportNode, reportFbId, picking, pending],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {menu && (
        <ContextLayer x={menu.x} y={menu.y} target={menu.target} onReport={pick} onClose={() => setMenu(null)} />
      )}
      {picking && <PickerLayer onPick={pick} onCancel={() => setPicking(false)} />}
      {pending && (
        <ComposerPopover
          anchor={pending.el}
          target={pending.target}
          makeReport={makeReport}
          onClose={() => setPending(null)}
        />
      )}
    </Ctx.Provider>
  );
}

/** A brand-minted id, as opposed to a filename that ships in templates/. */
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/** The chips that made this shot. Shape per composer/line.ts SentenceToken. */
function brieftokens(brief: unknown): { t: string; id?: string }[] {
  const t = (brief as { tokens?: unknown } | null | undefined)?.tokens;
  return Array.isArray(t) ? (t as { t: string; id?: string }[]) : [];
}

/** prefs.ts stores JSON; a bad value must never break a report. */
function readPref(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : String(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Mount the layer's stylesheet once, however many providers exist. */
function useStyles(): void {
  useEffect(() => {
    const ID = 'sc-fb-style';
    if (document.getElementById(ID)) return;
    const el = document.createElement('style');
    el.id = ID;
    el.textContent = css;
    document.head.append(el);
  }, []);
}
