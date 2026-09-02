import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Popover, Select, Spinner } from '@radix-ui/themes';
import { ArrowUp, Info, Lightning, Plus, SlidersHorizontal, X } from '@phosphor-icons/react';
import {
  api,
  imgUrl,
  nodeLabel,
  uploadImage,
  type Brand,
  type BriefPreview,
  type EngineInfo,
  type TreeNode,
} from '../api.js';
import { effectiveCategory } from '../productCategories.js';
import {
  briefTokens,
  BriefInput,
  emptySentence,
  FORMATS,
  type BriefInputHandle,
  type BriefToken,
  type SentenceToken,
} from '../composer/BriefInput.js';
import { AttachPanel, type AttachTab } from '../composer/AttachPanel.js';
import { ChipPreview, type PreviewKind } from '../composer/ChipPreview.js';
import { useHoverPreview } from '../composer/useHoverPreview.js';
import { ImageLightbox } from '../composer/ImageLightbox.js';
import { BrandInherited } from '../composer/BrandInherited.js';
import { SourceCards, type SourceItem } from '../composer/SourceCards.js';
import {
  CEILING_SENTENCE,
  IDENTITY_CAP,
  IDENTITY_KINDS,
  attachRoom,
  describedKeys,
  groupKey,
} from '../composer/attachRoom.js';
import {
  openOnGroup,
  RESOLUTIONS,
  ShotSettings,
  ShotSettingsFields,
  ShotSettingsPills,
  type QualityId,
} from '../composer/ShotSettings.js';
import { useOpenSettings, useOpenSetup } from '../app/dialogs.js';
import { effectiveEngineId, engineTitle, FALLBACK_ENGINE_ID } from '../engines/active.js';
import { sizingOf } from '../engines/capabilities.js';
import { OpenAIMark } from './OpenAIMark.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { PREF, useLocalPref, useRecipeSetting } from '../prefs.js';
import { useToasts } from '../toasts.js';
import { clearDraft, isNonTrivial, loadDraft, saveDraft } from '../draft.js';
import { useIngredientCatalog } from '../composer/useIngredientCatalog.js';
import { resolveSceneSwitch } from '../composer/applyScene.js';
import { aspectOfFormat, formatOfShot } from '../composer/formats.js';
import { reshapeOpFor } from '../composer/reshape.js';
import { failureToast } from '../failure.js';
import { attachedIdsKey, attachedIdsOf, type AttachedIds } from './railSections.js';

export interface ComposerHandle {
  /** Append a token to the brief (assets panel click path). */
  insertToken: (t: SentenceToken) => void;
  /** Attach a scene by id (assets panel click path). */
  applyScene: (id: string) => void;
  /** Open the attach panel on a tab, the way "New photoshoot" does. */
  openAttach: (tab: AttachTab) => void;
  focus: () => void;
  /** Run the brief as it stands. cmd+enter from anywhere reaches this. */
  submit: () => void;
}

/**
 * One field, one row. Everything attachable lives behind a single Attach
 * control, so the composer never becomes a control panel.
 */
export const Composer = forwardRef<
  ComposerHandle,
  {
    projectId: string | null;
    brand: Brand;
    engines: EngineInfo[];
    parent: TreeNode | null;
    shots: TreeNode[];
    initialBrief?: {
      tokens: BriefToken[];
      templateId?: string;
      templateFields?: Record<string, string>;
      /** Context the source shot carried; "reuse setup" rebuilds it as chips. */
      inherited?: BriefToken[];
      /** A curated example's own settings; absent on an ordinary remix. */
      variants?: number;
      quality?: QualityId;
    } | null;
    /**
     * A showcase recipe is on its way in via `initialBrief`, but hasn't landed
     * on this render yet (it arrives a commit later, from Create's own
     * effect) — known synchronously from the raw URL param, so the
     * draft-restore branch below never fires for content that's about to be
     * overwritten anyway, which would otherwise flash a stale "picked up
     * where you left off" banner for a draft the user never actually sees.
     */
    suppressDraftRestore?: boolean;
    /** Scene chosen before this project existed: seed it into the brief. */
    startScene?: string;
    /** A presenter picked from its own page, seeded the same way as a scene. */
    startPresenter?: string;
    /** A product picked from its own page, seeded the same way as a scene. */
    startProduct?: string;
    /**
     * One of the three seeds above has landed in the sentence, so whoever put
     * it in the URL should take it back out. A seed left in the address bar is
     * re-applied by the next mount, which is how removing a scene chip and
     * reloading used to put the same chip straight back.
     */
    onSeedsSpent?: () => void;
    /** Open the attach panel on this tab as soon as the composer mounts. */
    openAttachTab?: AttachTab;
    /**
     * The shot that was queued, so a caller filtered to a set can claim it.
     * The kind travels with it because only the caller can act on what it
     * means: a refine moves the chip onto the version it just made.
     */
    onQueued: (nodeId?: string, kind?: 'generation' | 'edit') => void;
    /**
     * A submit is in flight, with the prose of the brief that started it, so a
     * feed can stand something in for the shot before the server has answered.
     * Cleared here only on failure: on success the caller clears it once the
     * real shot has actually landed, or the tile would blink out and back in.
     */
    onSending?: (sending: { said: string; count: number } | null) => void;
    /**
     * Which assets the brief holds, published whenever that set changes.
     *
     * The rail ticks what is attached, and it cannot read a contenteditable.
     * Keyed rather than fired on every `sentence` change on purpose: the
     * sentence is a new array per keystroke, and re-rendering the rail while
     * someone types would be a jumping panel.
     */
    onAttached?: (ids: AttachedIds) => void;
    /**
     * The shot this brief will branch from, chosen with Branch. Null means a
     * new shot, which is the resting state and the only other one there is.
     */
    target?: TreeNode | null;
    /** Given only where the target can be dropped, which is where it is shown. */
    onClearTarget?: () => void;
    /**
     * Which image of the target to refine. The server defaults to the first,
     * so refining while looking at variant three used to silently edit variant
     * one — the picture on screen was not the picture being worked on.
     */
    sourceImage?: string;
    /** A restored draft's branch target: apply it without stealing focus. */
    onRestoreBranchId?: (id: string) => void;
    /** Which set the draft was written from, carried for information only. */
    setSlug?: string | null;
    /**
     * Whether this composer owns the brand's saved draft. There is one draft
     * per brand and more than one composer on screen — the dock keeps one, and
     * an open shot mounts another — so the second one says no: opening a shot
     * used to overwrite a typed draft with its own empty sentence, and leave
     * behind a branch target nobody had asked for.
     */
    persistDraft?: boolean;
    /**
     * Which shell this composer wears. The overlay variant is the shot
     * detail's refine composer: 300px wide, engine select folded into More,
     * and a "Carrying" strip stating what the refinement inherits.
     */
    variant?: 'dock' | 'overlay';
    /**
     * What the picture being refined is made of, for the overlay's band: the
     * shot detail resolves it from the lineage, the composer only wears it.
     */
    sourceItems?: SourceItem[];
  }
>(function Composer(
  {
    projectId,
    brand,
    engines,
    parent,
    shots,
    initialBrief,
    suppressDraftRestore,
    startScene,
    startPresenter,
    startProduct,
    onSeedsSpent,
    openAttachTab,
    onQueued,
    onSending,
    onAttached,
    target,
    onClearTarget,
    sourceImage,
    onRestoreBranchId,
    setSlug,
    persistDraft = true,
    // the shell distinction lives in CSS (.sc-ovl-edit scopes the overlay
    // variant); accepted so callers keep declaring which shell they mount
    variant = 'dock',
    sourceItems,
  },
  handleRef,
) {
  const { products: libraryProducts } = useBrand();
  const { demoProducts, loaded } = useAppData();
  /**
   * The brand's own scenes and presenters, ahead of the curated catalogs.
   *
   * Every consumer below takes these two lists: the attach panel, the sigil
   * menus, the chips, the scene-switch policy, and the per-chip warnings.
   * Missing any one of them would be worse than cosmetic — BriefInput drops a
   * token it cannot resolve, so a restored draft carrying a custom scene would
   * come back silently without it. The merge itself lives in
   * `useIngredientCatalog` now, which is also what the rail reads, so the two
   * cannot answer differently about what this brand owns.
   */
  const composerCatalog = useIngredientCatalog();
  const templates = composerCatalog.scenes;
  const presenters = composerCatalog.presenters;
  const openSettings = useOpenSettings();
  const openSetup = useOpenSetup();
  const { push } = useToasts();
  const usable = engines.filter((e) => e.available);
  const [engineId, setEngineId] = useLocalPref(PREF.engine, FALLBACK_ENGINE_ID);
  useEffect(() => {
    const next = effectiveEngineId(usable, engineId);
    if (next !== engineId) setEngineId(next);
  }, [usable, engineId, setEngineId]);

  // Nothing to generate with is stated where it applies: directly above the
  // brief, in a card built from the same material as the prompt card, so the
  // two read as a pair rather than as an alert dropped on the page.
  const setupNeeded =
    usable.length === 0 && engines.some((e) => e.code === 'not-installed' || e.code === 'not-authenticated');
  const noEngine = usable.length === 0;
  const engineNote = noEngine
    ? setupNeeded
      ? {
          // The mark of the thing the person actually brings: a ChatGPT account.
          // Codex CLI is our plumbing, and its name means nothing to someone who
          // has never opened a terminal. See OpenAIMark for the licensing.
          icon: <OpenAIMark />,
          title: 'Image generation is not set up yet',
          detail: 'About a minute, using the ChatGPT account you already have.',
          action: 'Set up' as const,
          onAct: () => openSetup(),
          info: true,
        }
      : {
          icon: <Lightning size={15} />,
          title: 'No image provider connected',
          detail: 'Add a provider key and this brief is ready to run.',
          action: 'Open settings' as const,
          onAct: () => openSettings('engines'),
          info: false,
        }
    : null;

  const [sentence, setSentence] = useState<SentenceToken[]>(emptySentence());
  const [seedTokens, setSeedTokens] = useState<SentenceToken[] | undefined>(undefined);
  const [prefFormat, setPrefFormat, borrowFormat] = useRecipeSetting(PREF.format, 'square');
  /**
   * A refinement's shape belongs to the picture being refined, never to the
   * machine.
   *
   * It used to be the machine's: one localStorage pref, read by the dock, by
   * this same composer inside an open shot, and by every other tab. So asking
   * one shot for 16:9 became the shape every later brief opened at — and the
   * next shot opened on a shape it had never been, which the composer then read
   * as a reshape and sent as a crop or an extend nobody had asked for.
   *
   * Kept in memory and keyed by node id: the pref stays the default for new
   * shots, a refine starts from what the shot already is, and a choice made
   * while refining belongs to that shot alone. Nothing is written to
   * localStorage, which is what lets two tabs hold two different shapes.
   */
  const [refineFormats, setRefineFormats] = useState<Record<string, string>>({});
  const refineTarget = target && target.kind !== 'root' ? target : null;
  /** What the shot on the chip already is, and the shape a reshape is measured from. */
  const sourceFormat = refineTarget ? formatOfShot(refineTarget.brief) : undefined;
  const formatId = refineTarget ? (refineFormats[refineTarget.id] ?? sourceFormat ?? prefFormat) : prefFormat;
  // Derived rather than seeded by an effect on purpose: the overlay reuses one
  // mounted composer as you walk from shot to shot, so a new target has to
  // resolve to its own shape on the very same render.
  const setFormatId = (id: string) => {
    if (refineTarget) setRefineFormats((m) => ({ ...m, [refineTarget.id]: id }));
    else setPrefFormat(id);
  };
  const [tplFields, setTplFields] = useState<Record<string, string>>({});
  const [count, setCount, borrowCount] = useRecipeSetting(PREF.count, 2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<(BriefPreview & { forBrief: unknown }) | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachTab, setAttachTab] = useState<AttachTab>('All');
  const [quality, setQuality, borrowQuality] = useRecipeSetting<QualityId>(PREF.quality, 'standard');
  const [uploading, setUploading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const briefRef = useRef<BriefInputHandle>(null);
  const attachRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachPanelId = useId();

  // per-brand draft persistence: an unsent brief must survive a navigation, a
  // brand switch, or a closed tab, none of which reliably unmount this component
  const contentRef = useRef({ tokens: sentence, tplFields, branchId: target?.id ?? null });
  contentRef.current = { tokens: sentence, tplFields, branchId: target?.id ?? null };
  const draftBrandIdRef = useRef<string | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Which `?scene=` value has already been applied, so a re-render with the
   * same value doesn't reapply it, but a genuinely new one still does. */
  const lastAppliedStartScene = useRef<string | undefined>(undefined);
  /** Same idea as above, for `?presenter=` and `?product=` — these just append
   * rather than swap, since a brief can carry more than one of either. */
  const lastAppliedStartPresenter = useRef<string | undefined>(undefined);
  const lastAppliedStartProduct = useRef<string | undefined>(undefined);

  const flushDraft = useCallback(
    (brandId: string) => {
      if (draftTimer.current) {
        clearTimeout(draftTimer.current);
        draftTimer.current = null;
      }
      // A composer that does not own the draft must not clear it either: an
      // open shot's empty sentence is not evidence that the dock's brief was
      // abandoned.
      if (!persistDraft) return;
      const c = contentRef.current;
      // A targeted composer is a refine conversation, and that conversation is
      // the URL's to keep, not the draft's. Persisting it made a month-old
      // refine hijack every later fresh Create into edit mode; saving OR
      // clearing here would also trample the create draft the user parked
      // before branching, so while a target is set the draft is simply left
      // alone.
      if (c.branchId) return;
      // Restoring is deliberately silent. It used to announce itself in a row
      // above the brief, on every return to Create, which is a notice about
      // something already on screen in the user's own words. Everything that
      // notice offered is reachable without it: emptying the brief clears the
      // stored draft on this very line, and a scene's fields belong to the
      // scene chip you can remove.
      if (isNonTrivial(c.tokens, c.tplFields))
        saveDraft(brandId, { tokens: c.tokens, tplFields: c.tplFields, setSlug });
      else clearDraft(brandId);
    },
    [setSlug, persistDraft],
  );

  // "New photoshoot" opens the attach panel; this is orthogonal to whatever
  // draft may or may not restore, so it's independent of the hydrate effect
  useEffect(() => {
    if (openAttachTab) {
      setAttachTab(openAttachTab);
      setAttachOpen(true);
    }
  }, [openAttachTab]);

  useEffect(() => {
    if (!initialBrief) return;
    // a stored brief carries its size too: lift it back out of the sentence
    const carriedFormat = (initialBrief.tokens ?? []).find((t) => t.t === 'format') as
      | Extract<BriefToken, { t: 'format' }>
      | undefined;
    // A curated example was shot at a chosen shape, variant count and
    // resolution. Left to the visitor's own prefs, a 4-variant catalog example
    // could open as a single draft frame and stop matching the tile it came
    // from. Borrowed for this brief rather than written: looking at an example
    // is not a decision about what every later shot should be. The shape used
    // to be the exception here, so opening one 16:9 example permanently
    // rewrote the default aspect of every shot after it.
    if (carriedFormat) borrowFormat(carriedFormat.id);
    if (initialBrief.variants) borrowCount(initialBrief.variants);
    if (initialBrief.quality) borrowQuality(initialBrief.quality);
    setSeedTokens(briefTokens(initialBrief));
    setTplFields(initialBrief.templateFields ?? {});
  }, [initialBrief]);

  /**
   * A brand switch does not remount this component (only the set route keys
   * on it), so this effect is what notices: it flushes whatever the outgoing
   * brand was holding, then hydrates the incoming brand's own saved draft —
   * unless a Remix is already claiming this mount, which is a genuine
   * full-brief replacement and should win over a silently restored one.
   *
   * A `?scene=` seed is deliberately NOT in that same "wins over restore"
   * bucket: it is folded into whatever this pass resolves as the base state
   * (restored or empty) and merged through the same `resolveSceneSwitch`
   * policy every other scene-attach entry point uses, so "Use in a shot" from
   * the Scenes page reads as attaching a scene to your draft, not replacing it.
   */
  useEffect(() => {
    const prior = draftBrandIdRef.current;
    if (prior && prior !== brand.id) flushDraft(prior);

    // a composer that does not own the draft does not restore one either
    const hasExplicitSeed = !!initialBrief || !!suppressDraftRestore || !persistDraft;
    // A restore is a once-per-brand event, which is what the dependency comment
    // at the bottom of this effect has always claimed. The effect itself re-runs
    // whenever a seed prop takes a new value, and re-reading the draft on those
    // runs reads storage the 500ms debounce has not caught up with yet: a seed
    // spent and cleared from the URL came back through here as the *previous*
    // sentence, overwriting the chip that had just been applied.
    const firstRunForBrand = prior !== brand.id;
    let tokens: SentenceToken[] | null = null;
    let tplFieldsToApply: Record<string, string> | null = null;

    if (!hasExplicitSeed && firstRunForBrand) {
      const draft = loadDraft(brand.id);
      if (draft && isNonTrivial(draft.tokens, draft.tplFields)) {
        tokens = draft.tokens;
        tplFieldsToApply = draft.tplFields;
      }
    }

    // Set by any of the three seed blocks below, so the owner of the URL can
    // take the spent param back out of it.
    let seedApplied = false;

    if (startScene && startScene !== lastAppliedStartScene.current) {
      lastAppliedStartScene.current = startScene;
      seedApplied = true;
      const base = tokens ?? emptySentence();
      const existingTok = base.find((t) => t.t === 'template') as Extract<SentenceToken, { t: 'template' }> | undefined;
      const existingSceneId = existingTok?.id ?? null;
      const sceneName = templates.find((t) => t.id === startScene)?.name ?? 'this scene';
      // A restored draft never carries a refine target any more (the URL owns
      // it, and this effect only runs on a fresh, target-less mount), so the
      // seed path resolves against no branch at all.
      const result = resolveSceneSwitch(existingSceneId, startScene, sceneName, null, null);
      if (result.changed) {
        tokens = [{ t: 'template', id: startScene }, ...base.filter((t) => t.t !== 'template')];
        if (result.toast) {
          const toast = result.toast;
          push({
            kind: 'success',
            title: toast.title,
            action: {
              label: 'Undo',
              onClick: () => {
                if (toast.prevSceneId) briefRef.current?.insert({ t: 'template', id: toast.prevSceneId });
                else briefRef.current?.removeTemplate();
              },
            },
          });
        }
      }
    }

    // Presenter and product seeds just append — unlike a scene there is no
    // single slot to swap, so no resolveSceneSwitch-style policy is needed.
    // Each still checks the base it is appending onto for its own id first:
    // a fresh mount resets `lastApplied*` to undefined, so arriving back at
    // the same `?presenter=`/`?product=` URL (a remount via back/forward, or
    // clicking "Use" again) must not re-add something the restored draft
    // already carries.
    if (startPresenter && startPresenter !== lastAppliedStartPresenter.current) {
      lastAppliedStartPresenter.current = startPresenter;
      seedApplied = true;
      const base = tokens ?? emptySentence();
      const already = base.some((t) => t.t === 'character' && t.id === startPresenter);
      if (!already) tokens = [...base, { t: 'character', id: startPresenter }];
    }
    if (startProduct && startProduct !== lastAppliedStartProduct.current) {
      lastAppliedStartProduct.current = startProduct;
      seedApplied = true;
      const base = tokens ?? emptySentence();
      const already = base.some((t) => t.t === 'product' && t.id === startProduct);
      if (!already) tokens = [...base, { t: 'product', id: startProduct }];
    }

    if (tokens) {
      setSeedTokens(tokens);
      setTplFields(tplFieldsToApply ?? {});
    }
    if (seedApplied) onSeedsSpent?.();
    draftBrandIdRef.current = brand.id;
    // deliberately keyed on brand.id + the three seed props: this must run
    // once per brand, and again whenever any of them takes on a new value
  }, [brand.id, startScene, startPresenter, startProduct]);

  useEffect(() => {
    if (!seedTokens) return;
    briefRef.current?.setTokens(seedTokens);
    setSeedTokens(undefined);
  }, [seedTokens]);

  /**
   * Size is the composer's, not the sentence's. It renders as nothing, so
   * keeping it in the token list meant every aspect or quality change repainted
   * the line and took the caret with it.
   */
  const format = useMemo(() => {
    const f = FORMATS.find((x) => x.id === formatId) ?? FORMATS[0];
    const edge = RESOLUTIONS.find((x) => x.id === quality)?.edge ?? 1024;
    const scale = edge / Math.max(f.w, f.h);
    const round8 = (n: number) => Math.max(256, Math.round((n * scale) / 8) * 8);
    return { t: 'format' as const, id: f.id, w: round8(f.w), h: round8(f.h) };
  }, [formatId, quality]);

  const tokens = useMemo<BriefToken[]>(() => [format, ...sentence], [format, sentence]);
  /**
   * The settings ride along with the sentence, because a recipe that cannot
   * reproduce its own shot is not a recipe: a retry of a four-variant run used
   * to come back with one frame, and reusing a setup dropped to whatever the
   * visitor's own prefs happened to say. The compiler reads `tokens` and
   * ignores the rest, so these are stored rather than compiled.
   */
  const brief = useMemo(
    () => ({ tokens, templateFields: tplFields, variants: count, quality, format: formatId }),
    [tokens, tplFields, count, quality, formatId],
  );
  const hasContent = sentence.some((t) => (t.t === 'text' ? !!t.v.trim() : true));
  /** The template now lives in the sentence, so read it back from the tokens. */
  const template = useMemo(() => {
    const tok = sentence.find((t) => t.t === 'template') as Extract<SentenceToken, { t: 'template' }> | undefined;
    return tok ? (templates.find((x) => x.id === tok.id) ?? null) : null;
  }, [sentence, templates]);
  const templateTokenId = useMemo(() => {
    const tok = sentence.find((t) => t.t === 'template') as Extract<SentenceToken, { t: 'template' }> | undefined;
    return tok?.id ?? null;
  }, [sentence]);

  /**
   * The one shared policy behind every live scene-attach entry point (the
   * Assets rail, the AttachPanel's Scenes tab, and `/` at the caret) — decides
   * through `resolveSceneSwitch`, applies through the same `insert`/
   * `removeTemplate` mechanics `place()` already uses for everything else.
   */
  const applyScene = useCallback(
    (sceneId: string) => {
      const existingSceneId = template?.id ?? null;
      const branchId = target?.id ?? null;
      const sceneName = templates.find((t) => t.id === sceneId)?.name ?? 'this scene';
      const result = resolveSceneSwitch(
        existingSceneId,
        sceneId,
        sceneName,
        branchId,
        target ? nodeLabel(target) : null,
      );
      if (!result.changed) return;
      briefRef.current?.insert({ t: 'template', id: sceneId });
      if (result.toast) {
        const toast = result.toast;
        push({
          kind: 'success',
          title: toast.title,
          action: {
            label: 'Undo',
            onClick: () => {
              if (toast.prevSceneId) briefRef.current?.insert({ t: 'template', id: toast.prevSceneId });
              else briefRef.current?.removeTemplate();
              if (toast.branchWasCleared && branchId) onRestoreBranchId?.(branchId);
            },
          },
        });
      }
    },
    [template, target, templates, push, onRestoreBranchId],
  );

  useImperativeHandle(handleRef, () => ({
    insertToken: (t) => briefRef.current?.insert(t),
    applyScene: (id) => applyScene(id),
    openAttach: (tab) => openAttach(tab),
    focus: () => briefRef.current?.focus(),
    submit: () => {
      void go();
    },
  }));

  // Derived here rather than in the rail because this is the only place the
  // live sentence exists. The key is what the effect watches, so typing text
  // around the chips publishes nothing.
  const attached = useMemo(() => attachedIdsOf(sentence), [sentence]);
  const attachedKey = attachedIdsKey(attached);
  const attachedRef = useRef(attached);
  attachedRef.current = attached;
  useEffect(() => {
    onAttached?.(attachedRef.current);
  }, [attachedKey, onAttached]);

  // a `?scene=` id (or a restored draft) that no longer resolves must not sit as
  // a silent, still-submittable chip — mirrors Create.tsx's stale-branch-target
  // toast for the same class of problem
  useEffect(() => {
    if (!loaded || !templateTokenId || template) return;
    briefRef.current?.removeTemplate();
    push({ kind: 'error', title: 'That scene is no longer available.', detail: 'Starting from scratch.' });
  }, [loaded, templateTokenId, template, push]);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The preview effect itself lives further down, after `mode` exists: a
  // refine preview must run the server's inheritance path (parentId), and
  // whether this send IS a refine is exactly what `mode` decides.

  // the draft is owed to whichever brand it belongs to, not necessarily the
  // one currently in `brand.id` — see the hydrate effect above
  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => flushDraft(draftBrandIdRef.current ?? brand.id), 500);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [sentence, tplFields, target?.id, brand.id, flushDraft]);

  useEffect(() => {
    // brand.id intentionally omitted from deps: an unmount must flush whatever
    // brand the content actually belongs to, not whatever brand.id is by then
    return () => flushDraft(draftBrandIdRef.current ?? brand.id);
  }, [flushDraft]);

  useEffect(() => {
    const onLeave = () => flushDraft(draftBrandIdRef.current ?? brand.id);
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [flushDraft, brand.id]);

  const engine = engines.find((e) => e.id === engineId);
  /** The engine's name as a person says it, for the lines that name it. */
  const engineLabel = engine ? engineTitle(engine.displayName) : 'This engine';

  /**
   * What this brief will do, and why.
   *
   * Mode used to be inferred from whichever shot the screen had quietly
   * selected, so the send button changed meaning on its own and the only way to
   * find out which one you were about to get was to press it. Now a branch is
   * something you ask for: `target` is set by Branch and by nothing else.
   *
   * Two things overrule a target, and both say so on screen rather than
   * silently doing the other thing:
   *  - an engine that cannot edit has nothing to branch with
   *  - a scene is a fresh setup, so it starts a new shot by definition
   */
  /**
   * The version this brief is pointed at is still rendering. It counts as a
   * target — the chip stays, so the thread of what you are working on is not
   * dropped — but it cannot be refined until there is a picture to refine.
   */
  const targetPending = !!target && target.kind !== 'root' && target.status === 'running';
  const branchable =
    (target && target.kind !== 'root' && target.status === 'done' && target.images.length > 0) || targetPending;
  const engineCanEdit = !!engine?.supportsEdit;
  /**
   * A scene is checked here and not only in the effect below, because the
   * effect can only speak where the target can be dropped. Inside an open shot
   * the target is the shot itself and there is no chip to let go, so attaching
   * a scene there used to quietly run as an edit of the picture on screen —
   * the one thing a scene is defined not to be.
   */
  /**
   * Asking for a different shape used to be asking for a different photograph.
   *
   * It ran as a new shot from the same setup, so a square somebody liked, asked
   * for at 16:9, came back as a different picture. It is a reshape now, and the
   * user says which of the two honest ops they mean: CROP cuts the original
   * down to the new shape — pure geometry, no engine, every kept pixel exactly
   * the one they had — while EXTEND keeps the whole photograph and generates
   * only the margin, then lays the original back over the answer.
   *
   * A scene still starts a new shot, because that really is a different brief
   * rather than a bigger frame.
   */
  // One reading of the shot's own shape for both halves: the shape this opens
  // at and the shape a reshape is measured against cannot disagree.
  const reshaping = !!refineTarget && !!sourceFormat && sourceFormat !== formatId;
  const reshapeChoiceOpen = reshaping && branchable && !template;
  // The op is inferred, never asked: pick a target shape and the geometry
  // decides (toward square = crop, away = extend, and an extend past the
  // growth bound is a crop wearing its honest name — reshapeOpFor). The two
  // override buttons this used to render made the user resolve a question the
  // classifier already answers; nothing runs until Refine either way.
  const reshapeOp: 'crop' | 'extend' | null = reshapeChoiceOpen
    ? reshapeOpFor(aspectOfFormat(sourceFormat), aspectOfFormat(formatId))
    : null;
  const cropping = reshapeOp === 'crop';
  /*
   * Growing a shot into a bigger frame needs an engine that can paint a margin
   * around a picture. An engine that only re-renders a whole frame from a
   * sentence cannot: measured three times on one unchanged shot, the join came
   * back clean, then badly broken, then clean again. That is a coin toss, and a
   * coin toss is worse to ship than an honest absence — so this asks the
   * engine, and offers the crop to anything that answers no.
   */
  // Growing a frame always works: an engine that can genuinely paint a margin
  // is asked to, and everything else gets the same shape built locally from
  // the picture's own edge — seamless by construction, identical every run,
  // and free. So this needs no engine at all, exactly like a crop.
  // Growing a frame still needs an engine: the margin is generated, unlike a
  // crop, which is pure geometry and needs nothing at all.
  const expanding = reshapeOp === 'extend' && engineCanEdit;
  const targetShape = FORMATS.find((x) => x.id === formatId);
  const targetShapeLabel = targetShape ? `${targetShape.label} ${targetShape.hint}` : formatId;

  /**
   * The one image open full size. Ephemeral by construction: local state,
   * never a draft, never storage, so a reload or a navigation simply has
   * neither. It lives here rather than inside each surface that can ask for
   * one, so there is exactly one per composer — the brief line asks through
   * `onInspect`. The carried-context strip that also fed this is gone: the
   * shot record above the overlay composer states that context now, once.
   */
  const [lightbox, setLightbox] = useState<{ src: string; kind: PreviewKind; label: string | null } | null>(null);
  /** The hover peek on the target chip: the same card, on the same timing, a
      chip in the sentence gets. */
  const targetHover = useHoverPreview<{ anchor: HTMLElement }>();
  const openTargetImage = () => {
    if (!target?.images[0]) return;
    targetHover.closeNow();
    setLightbox({ src: imgUrl(target.images[0]), kind: 'shot', label: null });
  };
  // A crop needs no engine at all, so it is an edit even when nothing can edit.
  const mode: 'generation' | 'edit' =
    branchable && !template && (engineCanEdit || cropping || expanding) ? 'edit' : 'generation';
  /** The hub has a refine armed, so scenes sit out of every attach door: a
      scene would start a new shot, and trading the armed refine for a chip as
      a click's side effect is the mode flip this composer refuses. Hub only —
      the overlay has no armed chip to lose. */
  // The shell, not the X, decides: inside an open shot a scene still starts a
  // new shot in place (the note says so), while the hub's attach panel sits
  // scenes out. The X exists in both shells now, so it cannot be the proxy.
  const scenesSitOut = mode === 'edit' && !!target && variant !== 'overlay';
  // No reshape tutorial here anymore: the op is inferred, and the whole
  // explanation is the two-word state line rendered beside the shape picker.
  const targetNote = !branchable
    ? null
    : template
      ? 'A scene starts a new shot.'
      : cropping || expanding
        ? null
        : !engineCanEdit
          ? `${engine?.displayName ?? 'This engine'} cannot edit. This makes a new shot.`
          : // A version still rendering used to add a sentence here; the chip's
            // own shimmer already says it, and the held send button's tooltip
            // (blockedReason) explains itself to anyone who asks.
            null;

  /**
   * What is currently set, so the one control can still say it out loud.
   *
   * Display labels, never the stored ids: this used to announce "Aspect
   * portrait, quality high". And on a refinement it named the one setting that
   * surface does not contain, because a refine carries no size.
   */
  const settingsSummary = useMemo(() => {
    const f = FORMATS.find((x) => x.id === formatId) ?? FORMATS[0];
    const shape = `Aspect ${f.label} ${f.hint}`;
    if (mode === 'edit') return shape;
    const r = RESOLUTIONS.find((x) => x.id === quality);
    const sizing = sizingOf(engineId);
    // Spoken aloud, "resolution High 1536 px" is a claim. On an engine that is
    // only asked for a size it is a request, and the summary says which.
    const size =
      sizing === 'ratio' || !r
        ? null
        : sizing === 'advisory'
          ? `${r.label}, asking for ${r.edge} px`
          : `${r.label} ${r.edge} px`;
    return [shape, `${count} shot${count === 1 ? '' : 's'}`, size && `resolution ${size}`].filter(Boolean).join(', ');
  }, [mode, formatId, count, quality, engineId]);

  /**
   * A scene is a fresh setup, so it cannot also be an edit of an existing shot.
   * Rather than explain that in a sentence nobody asked for, the LOSER simply
   * lets go, and which side loses is whichever the user asked for first: a
   * scene landing while a refine is armed drops the branch chip; re-arming a
   * refine while a scene chip sits in the sentence drops the scene chip. The
   * old rule made the scene win both ways, so pressing Refine with a scene
   * attached was refused over and over until the chip was removed by hand.
   * Both refs start undefined so a mount that restores both (a draft's scene
   * plus a ?branch= URL) resolves the old way: the scene wins.
   */
  const prevTargetId = useRef<string | null | undefined>(undefined);
  const prevTemplateId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const targetId = branchable ? (target?.id ?? null) : null;
    const targetChanged = targetId !== prevTargetId.current && prevTargetId.current !== undefined;
    prevTargetId.current = targetId;
    const templateChanged = templateTokenId !== prevTemplateId.current;
    prevTemplateId.current = templateTokenId;
    if (!template || !branchable) return;
    if (targetChanged && !templateChanged && targetId) briefRef.current?.removeTemplate();
    else onClearTarget?.();
  }, [template, templateTokenId, branchable, target, onClearTarget]);
  // A scene that wants a product still runs without one: it says "the product"
  // instead. Nine of ten ask for one, so refusing here meant a brand with no
  // products could never generate at all. Warn, allow.
  //
  // The phrase is the compiler's, from packages/cli/src/brief.ts: change the
  // wording there and this stops matching, with nothing to say it has.
  const blocking = preview?.warnings.filter((w) => w.includes('built around a product')) ?? [];
  // the workspace arrives a beat after the screen does, and typing is faster
  // than a round trip: without this the first brief of a cold load could be sent
  // into nothing and come back as an error the user did nothing to cause.
  //
  // A version still rendering also holds the button: sending now would quietly
  // make a new shot instead of continuing the one on the chip, which is the
  // exact silent substitution this composer exists not to do.
  // A reshape needs no words: the shape change IS the brief. A crop with
  // words would silently ignore them, so it is blocked out loud instead.
  const aspectOnly = reshapeChoiceOpen && !hasContent;
  const cropWithWords = cropping && hasContent;
  const canGo =
    !busy && (hasContent || aspectOnly) && !cropWithWords && !!projectId && !targetPending && (cropping || !noEngine);
  /** Why the button will not go, in the words of the thing that is blocking. */
  const blockedReason =
    noEngine && !cropping
      ? 'Image generation is not set up yet'
      : busy
        ? 'Working on the last one'
        : !projectId
          ? 'Still opening this brand'
          : targetPending
            ? 'Wait for this version to finish, or press X to start a new shot'
            : cropWithWords
              ? 'This shape is reached by cropping, and a crop uses no words. Clear the brief, or keep the current shape.'
              : !hasContent && !aspectOnly
                ? 'Write a brief first'
                : null;

  /**
   * The compiler's own reading of the brief, refreshed as it changes. For a
   * refine (mode edit with a target) the parent rides along, so the server
   * runs the same inheritance-and-budget path the send will run and the
   * carried-context strip can never disagree with the request — and an empty
   * refine brief still previews, because the strip must show before typing.
   */
  useEffect(() => {
    const refining = mode === 'edit' && !!target;
    // A crop compiles nothing and calls no engine: previewing the compile
    // that will never run would show carried-context claims for a pure
    // geometry operation.
    if (cropping || (!hasContent && !refining)) {
      setPreview(null);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    // The answer is stamped with the brief it describes: a chip pasted while
    // an older preview is still current must not be judged against it.
    const requested = brief;
    debounce.current = setTimeout(() => {
      void api
        .previewBrief(brief, engineId, brand.id, refining ? target.id : undefined)
        .then((p) => setPreview({ ...p, forBrief: requested }))
        .catch(() => setPreview(null));
    }, 280);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [brief, engineId, brand.id, hasContent, mode, target, cropping]);

  /**
   * Choosing from one of these menus hands the caret straight back, rather than
   * waiting for the menu to finish closing: Radix restores focus to the trigger
   * on close, and a keystroke that arrives in between would be lost.
   */
  const setFormat = (id: string) => {
    setFormatId(id);
    briefRef.current?.focus();
  };
  const setQualityId = (q: QualityId) => {
    setQuality(q);
    briefRef.current?.focus();
  };
  const setVariants = (n: number) => {
    setCount(n);
    briefRef.current?.focus();
  };
  /**
   * A Radix menu returns focus to its trigger on close, so picking an aspect or
   * a quality left the brief without a caret and the next keystroke went
   * nowhere. Focus moved away for real here, so handing it back is a genuine
   * transition and the editing caret is re-established with it.
   */
  const backToBrief = (e: Event) => {
    e.preventDefault();
    briefRef.current?.focus();
  };

  const openAttach = (tab: AttachTab) => {
    setAttachTab(tab);
    setAttachOpen(true);
  };
  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    // the file <input> already filters to accept="image/*"; a drop has no such
    // OS-level filter, so this is the one place both paths get one
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!images.length) {
      push({ kind: 'error', title: 'Only images can be attached here' });
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      for (const f of images.slice(0, 4)) {
        const hash = await uploadImage(f);
        // the same caret-aware insert every other pick uses: appending through
        // state repainted the line while focus was on the file dialog, which
        // dropped the caret and left the brief untypeable
        briefRef.current?.insert({ t: 'ref', imageHash: hash });
      }
      // the cap is fine, the silence was not: the fifth file used to vanish
      // with nothing anywhere saying so
      if (images.length > 4)
        push({
          kind: 'error',
          title: 'Only the first 4 images were attached',
          detail: `${images.length - 4} more ${images.length - 4 === 1 ? 'was' : 'were'} skipped. Attach ${images.length - 4 === 1 ? 'it' : 'them'} in another pick.`,
        });
    } catch (e: any) {
      setErr(String(e.message ?? e));
      push(failureToast(e, 'Could not attach that image'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // warnings live ON the affected chip, not as sentences in the card.
  // Only a preview that answered THIS brief may flag anything: a chip pasted
  // while an older answer was current is simply absent from that answer, and
  // judging it against one flashed a false amber underline until the
  // debounced refresh landed.
  const settledPreview = preview && preview.forBrief === brief ? preview : null;
  /**
   * The budget, as the compiler last reported it.
   *
   * Every edit blanks the preview until the debounced refresh lands, and a
   * gate that read null as "room" was outrun by a second click. So the last
   * settled reading holds while the next is in flight, and only an empty
   * brief forgets it: with no identities there is nothing to seat.
   */
  const identityCount = useMemo(() => sentence.filter((t) => IDENTITY_KINDS.has(t.t)).length, [sentence]);
  const lastBudget = useRef<{ room: ReturnType<typeof attachRoom>; described: Set<string> } | null>(null);
  const budget = useMemo(() => {
    if (identityCount === 0) {
      lastBudget.current = null;
      return null;
    }
    if (settledPreview) {
      lastBudget.current = { room: attachRoom(settledPreview), described: describedKeys(settledPreview) };
    }
    return lastBudget.current;
  }, [settledPreview, identityCount]);
  const room = budget?.room ?? null;
  const engineName = engine?.displayName ?? 'This engine';
  /** The one sentence for a reference or a mark refused at a full budget. */
  const seatFull =
    room && room.left <= 0
      ? `${engineName} pictures ${room.cap} per shot, and a reference or a mark needs one of them. Remove a photo to make room.`
      : null;
  /**
   * The panel's line while seats are full but the shot can still take
   * identities: how many are pictured, how many ride as words, and the one
   * move that changes which is which.
   */
  const seatsHint =
    room && room.left <= 0
      ? `${engineName} pictures ${room.cap} of the ${identityCount} identities here; the rest ride as words. Drag a chip earlier to picture it instead.`
      : null;
  /** The ceiling on identities per shot, engine-independent. */
  const ceilingFull = identityCount >= IDENTITY_CAP ? CEILING_SENTENCE : null;
  const describedToken = (t: BriefToken): boolean => {
    const set = budget?.described;
    if (!set || set.size === 0) return false;
    if (t.t === 'product') return set.has(groupKey('product', t.id));
    if (t.t === 'character') return set.has(groupKey('character', t.id));
    if (t.t === 'template') return set.has(groupKey('scene', t.id));
    if (t.t === 'ref') return set.has(groupKey('reference', t.imageHash));
    if (t.t === 'mark') return set.has(groupKey('brand', t.imageHash));
    return false;
  };
  const describedNote = room
    ? `Described in words: ${engineName} pictures ${room.cap} per shot. Drag it earlier to picture it instead.`
    : null;
  const templateFlag = !template
    ? null
    : blocking.length > 0
      ? 'This scene builds around a product. Attach one.'
      : // The person half of the same compiler warning had no chip to sit on,
        // so a scene needing a presenter said nothing at all until the picture
        // came back with a stranger in it.
        (settledPreview?.warnings.some((w) => w.includes('built around a person')) ?? false)
        ? 'This scene builds around a person. Attach a presenter.'
        : null;
  /**
   * Which chips get a mark, and what it says.
   *
   * A photo that does not exist has a different remedy than a photo the
   * engine cannot seat, which differs again from an engine that reads no
   * images at all: the chip says the one the user can act on. The compiler
   * classifies the loss (`reason`, `cap`), the chip only speaks it. Words
   * alone give the right kind of person, never the person, so a chip whose
   * photo stayed home is always marked.
   */
  const flagToken = (t: BriefToken): string | null => {
    if (t.t === 'template') return templateFlag;
    if (!settledPreview) return null;
    const engineName = engine?.displayName ?? 'this engine';
    const cap = settledPreview.cap;
    /**
     * The sentence for a photo the engine could have read but had no seat
     * for. `what` is the mid-sentence form ("this reference", "Astrid's
     * photo"); the variants that open with it capitalise its first letter, a
     * name keeps its own case.
     */
    const noSeat = (what: string) => {
      const What = what.charAt(0).toUpperCase() + what.slice(1);
      return cap === 0
        ? `${What} won't reach ${engineName}. Choose an engine that reads images.`
        : cap == null
          ? // An older server says nothing about its cap: no reason, no blame.
            `${What} won't reach ${engineName} this time.`
          : `${engineName} takes ${cap} photos per shot and ${what} didn't get a seat. Remove a photo to make room.`;
    };
    const missingIdentity = (role: 'product' | 'character', id: string) =>
      settledPreview.dropped?.some((d) => d.role === role && d.id === id && d.reason === 'missing') ?? false;
    if (t.t === 'ref' && !settledPreview.attachments.some((a) => a.hash === t.imageHash)) {
      return cap === 0
        ? `This reference won't reach ${engineName}. Choose an engine that reads images, or remove it.`
        : noSeat('this reference');
    }
    // The brand mark is an attachment like any other, and it used to be the
    // one kind that could be dropped with no mark on its chip at all.
    if (t.t === 'mark' && !settledPreview.attachments.some((a) => a.role === 'brand' && a.hash === t.imageHash)) {
      return cap === 0
        ? `The brand mark won't reach ${engineName}, so the logo can't be drawn from it. Choose an engine that reads images.`
        : `${noSeat('the brand mark')} The logo can't be drawn from it.`;
    }
    // A tiny mark rides, but its fine lettering is already subpixel: the
    // compiler measured the stored file and said so (the 'px across' phrase
    // is the contract, same pattern as 'built around a person' above).
    if (t.t === 'mark') {
      const small = settledPreview.warnings.find((w) => w.includes('px across'));
      if (small) return small;
    }
    if (t.t === 'product') {
      // Demo products live in their own list, so a chip naming one resolved to
      // nothing here and silently skipped the check: exactly the products the
      // homepage examples are built from.
      const products = libraryProducts.length ? libraryProducts : (brand.json?.products ?? []);
      const p = products.find((x: any) => x.id === t.id) ?? demoProducts.find((x) => x.id === t.id);
      // Match on id, never on label: a display name is free to differ from the
      // descriptive phrase the compiler labels the attachment with, and two
      // products may legitimately share a name.
      if (p && !settledPreview.attachments.some((a) => a.role === 'product' && a.id === p.id)) {
        // A product with no seat rides as words: the chip dims, the card
        // says so, and nothing here shouts.
        return missingIdentity('product', p.id) ? `${p.name} has no usable photo. Re-add one, or remove this.` : null;
      }
    }
    // A presenter is an identity too. Without this, a face the engine could not
    // carry was dropped with no mark on the chip that asked for it.
    if (t.t === 'character') {
      const c = presenters.find((x) => x.id === t.id);
      if (c && !settledPreview.attachments.some((a) => a.role === 'character' && a.id === c.id)) {
        return missingIdentity('character', c.id) ? `${c.name} has no usable photo. Re-add one, or remove this.` : null;
      }
    }
    return null;
  };

  const go = async () => {
    if (!canGo) return;
    setBusy(true);
    setErr(null);
    // the prose only: chips are pictures, and this is a one-line caption for a
    // tile that exists for a second or two
    const said = sentence
      .flatMap((t) => (t.t === 'text' ? [t.v] : []))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    // one stand-in tile per expected sibling: a generation asks for `count`
    // shots, an edit always comes back as one
    onSending?.({ said: said || 'Your shot', count: mode === 'generation' ? count : 1 });
    try {
      // the brand's workspace always exists by the time a brief can be run; a
      // missing one is a load that has not landed, not a container to invent
      if (!projectId) throw new Error('the workspace is still loading');
      const created = await api.addNode({
        projectId,
        // an edit hangs off the shot it edits; anything else hangs off the
        // root, so a brief that only *looked* like a branch is not filed as a
        // version of a shot it never used
        parentId: mode === 'edit' && target ? target.id : (parent?.id ?? null),
        kind: mode,
        engineId,
        count,
        brief,
        // refine works from the picture you are looking at, not from whichever
        // one the run happens to have first
        ...(mode === 'edit' && sourceImage ? { sourceImage } : {}),
        // the reshape op is explicit on the wire: crop and extend preserve
        // pixels in opposite ways, and the server must never have to guess
        ...(mode === 'edit' && reshapeOp ? { reshape: reshapeOp } : {}),
      });
      /*
       * A scene used to be able to declare text zones, and this turned them
       * into editable layers on every variant as the shot was queued. No scene
       * in the catalog has ever declared one — 0 of 72 — so this ran for
       * nobody while sitting in the middle of the one path every brief takes.
       * `Scene.textZones` still exists in the schema; if a scene ever carries
       * zones again, this belongs here.
       */
      // The compiler's own account of what it had to do without. These name
      // real fidelity risks and the server has always sent them back on the
      // accepted shot; only the first used to be surfaced, so a dropped
      // reference could hide behind whatever warning happened to come first.
      const warned = created.warnings ?? [];
      if (warned.length === 1) push({ kind: 'success', title: 'Sent, with one thing to know', detail: warned[0] });
      else if (warned.length > 1)
        push({
          kind: 'success',
          title: `Sent, with ${warned.length} things to know`,
          detail: warned.join(' '),
        });

      briefRef.current?.setTokens(emptySentence());
      setTplFields({});
      // the borrowed settings belonged to the brief that just left the screen
      borrowFormat(null);
      // and so did a shape chosen while refining: the chip moves onto the
      // version this just made, which carries a recorded shape of its own
      setRefineFormats({});
      borrowCount(null);
      borrowQuality(null);
      if (persistDraft) clearDraft(brand.id);
      onQueued(created.id, mode);
    } catch (e: any) {
      const message = String(e.message ?? e);
      // A failed send is an event, and this app already has one place for
      // events: the same toast the success path above uses. It had its own
      // card above the composer, which meant a transient failure permanently
      // owned layout and stacked on top of whatever else the input had to say.
      // Errors are never trimmed and outlive successes (see ToastProvider), so
      // nothing is lost by not building a second surface for them.
      setErr(message);
      push({ kind: 'error', title: 'That did not send', detail: message });
      // the brief is deliberately not cleared above until the shot exists, so
      // everything typed is still on screen to send again
      onSending?.(null);
    } finally {
      setBusy(false);
    }
  };

  const activeProductId = sentence.find((t) => t.t === 'product')?.id;
  /**
   * The category behind every "Suited to X" lift.
   *
   * Resolved across all three places a product token can point — the live
   * library, brand.json, and the Scenri library — and through
   * `effectiveCategory`, which falls back to the guess a catalog import's
   * productType supports. Reading `p.category` raw off `libraryProducts` alone
   * meant a demo product resolved to nothing, so the homepage's own examples
   * were exactly the briefs that got no recommendations at all.
   */
  const activeProduct = activeProductId
    ? (libraryProducts.find((p) => p.id === activeProductId) ??
      ((brand.json?.products ?? []) as any[]).find((p: any) => p.id === activeProductId) ??
      demoProducts.find((p) => p.id === activeProductId) ??
      null)
    : null;
  const activeProductCategory = activeProduct ? effectiveCategory(activeProduct as any) : null;

  return (
    <div className="sc-composer">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void pickFiles(e.target.files)}
      />

      {/* One lightbox for the whole composer: the brief line asks for it
          through onInspect, the carried strip through its own click, and only
          one can ever be up because it is a modal. */}
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          kind={lightbox.kind}
          label={lightbox.label}
          onRestoreFocus={() => briefRef.current?.restoreCaret()}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* The target chip's hover peek: the same card a sentence chip gets. */}
      {targetHover.shown && target?.images[0] && (
        <ChipPreview
          anchor={targetHover.shown.anchor}
          kind="shot"
          src={imgUrl(target.images[0])}
          onOpen={openTargetImage}
          onHoverIn={targetHover.keep}
          onHoverOut={targetHover.close}
          onClose={targetHover.closeNow}
        />
      )}

      {attachOpen && (
        <AttachPanel
          brand={brand}
          activeProductCategory={activeProductCategory}
          refining={scenesSitOut}
          full={ceilingFull}
          seatsFull={seatsHint}
          shots={shots}
          initialTab={attachTab}
          id={attachPanelId}
          onUpload={() => fileRef.current?.click()}
          onToken={(t) => briefRef.current?.insert(t)}
          onTemplate={(id) => applyScene(id)}
          onClose={() => {
            // A close issued from inside the panel (Escape, the X) would drop
            // keyboard focus to body with the panel; hand it to the opener.
            const wasInside = !!document.activeElement?.closest?.('.sc-attachpanel');
            setAttachOpen(false);
            if (wasInside) attachRef.current?.focus();
          }}
        />
      )}
      {/* A refusal is written for a person to act on — which engine cannot carry
          the product, which cap was hit — and it used to reach the screen only
          as the send button's tooltip, where nobody looks after a click that
          appeared to do nothing. It sits closest to the card because it is
          about the brief still sitting in it. */}
      {/* Everything this composer has to say about itself, in one tray docked
          above the card and inset from its edges, so it reads as subordinate to
          the input rather than as a second surface of equal weight.
          One tray, not one card per notice: two notices used to stack into three
          boxes, which is what read as unfinished. */}
      {engineNote && (
        <div className="sc-notes">
          {engineNote && (
            <div className="sc-banner" data-tone="action">
              <span className="sc-banner-ic">{engineNote.icon}</span>
              <span className="sc-banner-txt">
                <b>{engineNote.title}</b>
                <small>
                  {engineNote.detail}
                  {engineNote.info && (
                    <Popover.Root>
                      <Popover.Trigger>
                        <button
                          type="button"
                          className="sc-note-info"
                          aria-label="What a ChatGPT account has to do with this"
                        >
                          <Info size={13} />
                        </button>
                      </Popover.Trigger>
                      <Popover.Content className="sc-note-pop" align="start" sideOffset={8} width="300px">
                        <p>
                          Codex CLI signs in with your ChatGPT account and makes the images there. Every plan includes
                          some Codex usage, so how many images you get depends on the plan you are on.
                        </p>
                        <p>No ChatGPT account, or run out for now? Use your own key from an image provider instead.</p>
                        <p className="sc-note-pop-fine">
                          Scenri never sees your password or token. The sign-in happens in your browser and stays with
                          Codex.
                        </p>
                        <button type="button" className="sc-btn sc-btn-ghost" onClick={() => openSettings('engines')}>
                          Use a provider key instead
                        </button>
                      </Popover.Content>
                    </Popover.Root>
                  )}
                </small>
              </span>
              <button type="button" className="sc-banner-act" data-primary="" onClick={engineNote.onAct}>
                {engineNote.action}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="sc-promptcard">
        {/* What this brief is about to do, stated before it does it. The hub
            wears the one Refining chip, with its X; the overlay wears the
            picture's own contents as cards, the deeper level of the same
            band. */}
        {branchable && onClearTarget && (
          <div className="sc-target" data-note={targetNote ? '' : undefined}>
            {/* The version being refined, worn as the one chip pattern the app
                has: the sentence's own .sc-token as a small inverse card, the
                shot's picture first, then the word for what is happening. Not
                the shot's prompt: that read as a truncated instruction, not a
                name. Hover peeks at the image the way a sentence chip does;
                click opens it full size. */}
            {/* biome-ignore lint/a11y/useSemanticElements: a <button> cannot hold the remove <button> the chip pattern floats over its right edge; the sentence's own chips are the same span-as-button */}
            <span
              className="sc-token sc-target-chip"
              role="button"
              tabIndex={0}
              aria-haspopup="dialog"
              aria-label={`Version being refined: ${nodeLabel(target)}. Open the image, or remove to make a new shot.`}
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse' && target.images[0]) targetHover.open({ anchor: e.currentTarget });
              }}
              onPointerLeave={(e) => e.pointerType === 'mouse' && targetHover.close()}
              onClick={openTargetImage}
              onKeyDown={(e) => {
                // the X inside bubbles its keys up here; only the chip's own
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openTargetImage();
                }
              }}
            >
              {/* a version that has just been asked for has no picture yet, and
                  the same shimmer the feed uses says so without a second word */}
              {target.images[0] ? (
                <img src={imgUrl(target.images[0])} alt="" />
              ) : (
                <span className="sc-target-thumb sc-shimmer" />
              )}
              Refining
              {onClearTarget && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    targetHover.closeNow();
                    onClearTarget();
                  }}
                  aria-label="Make a new shot instead"
                >
                  <X size={12} />
                </button>
              )}
            </span>
            {targetNote && <small className="sc-target-note">{targetNote}</small>}
          </div>
        )}
        {variant === 'overlay' && sourceItems && sourceItems.length > 0 && (
          <div className="sc-target" data-note={targetNote ? '' : undefined}>
            <SourceCards items={sourceItems} />
            {targetNote && <small className="sc-target-note">{targetNote}</small>}
          </div>
        )}
        {/* Where there is no band to carry it, the note still has to be said:
            inside an open shot this is the only sign that what is about to
            happen is a new shot rather than a change to the one on screen. */}
        {branchable && !onClearTarget && targetNote && !(variant === 'overlay' && sourceItems?.length) && (
          <small className="sc-target-note sc-target-note-alone">{targetNote}</small>
        )}
        {/* The inferred op, stated in two words. The old fieldset asked the
            user to pick Crop or Extend when the geometry already decides
            (defaultReshapeOp); picking a shape is the whole gesture, and this
            line only makes the consequence predictable before Refine. */}
        {reshapeChoiceOpen && (cropping || expanding) && (
          <small className="sc-reshape-hint" aria-live="polite">
            {cropping ? 'Will crop to' : 'Will extend to'} {targetShapeLabel}
          </small>
        )}
        <BriefInput
          ref={briefRef}
          onChange={setSentence}
          brand={brand}
          shots={shots}
          templates={templates}
          presenters={presenters}
          demoProducts={demoProducts}
          onTemplatePick={applyScene}
          scenesSitOut={scenesSitOut}
          flag={flagToken}
          seatFull={seatFull}
          described={describedToken}
          describedNote={describedNote}
          onInspect={(image) => setLightbox(image)}
          onAttachRequest={(tab) => openAttach(tab)}
          activeProductCategory={activeProductCategory}
          placeholder={
            template
              ? 'Add art direction, or run it as written'
              : mode === 'edit'
                ? // Not "or describe a new one". Everything typed here is sent as
                  // a change to the picture on the chip: an unrelated brief would
                  // be painted over that photo rather than shot fresh. Starting
                  // something new is what the chip's own X is for, which is why
                  // it is labelled "Make a new shot instead".
                  'Say what to change about this shot'
                : 'What should we shoot? (use $ / @ #)'
          }
          placeholderSm={template || mode === 'edit' ? undefined : 'What should we shoot? ($ / @ #)'}
          onSubmit={() => void go()}
          onDropFiles={(files) => void pickFiles(files)}
        />

        <BrandInherited brandId={brand.id} revision={brand.updatedAt} />

        <div className="sc-prompt-row">
          <div className="sc-prompt-left">
            {/* One click, not two.

                This used to open a menu naming five kinds, and picking one
                opened a panel that already had those same five as tabs. The
                menu was a question the panel then asked again, so it is gone
                and the panel opens on All. The kinds are still one click away,
                as its tabs, and `$` `/` `@` `#` still open the same list inline at
                the caret for anyone who would rather not leave the keyboard. */}
            <button
              type="button"
              ref={attachRef}
              className="sc-icon-btn sc-attach-toggle"
              aria-expanded={attachOpen}
              aria-controls={attachOpen ? attachPanelId : undefined}
              aria-label="Attach"
              title="Attach a product, a scene, a colour or an image"
              onClick={() => (attachOpen ? setAttachOpen(false) : openAttach('All'))}
            >
              {uploading ? <Spinner size="1" /> : <Plus size={16} />}
            </button>

            {/* A picker with one option is a question with one answer, so with
                a single usable engine there is no picker at all — the engine's
                name lives in Settings, and the menu returns on its own once a
                second engine connects. */}
            {usable.length > 1 && (
              <Select.Root value={engineId} onValueChange={setEngineId}>
                <Select.Trigger variant="ghost" className="sc-mini-sel">
                  <Lightning size={14} />
                  <span className="sc-mini-sel-t">{engine ? engineTitle(engine.displayName) : 'Demo'}</span>
                </Select.Trigger>
                <Select.Content>
                  {usable.map((e) => (
                    <Select.Item key={e.id} value={e.id}>
                      {engineTitle(e.displayName)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            )}
          </div>

          <div className="sc-prompt-right">
            {/*
              Three shells, one set of settings.

              Where the row is wide and pointer-driven — the desktop hub — the
              three settings are pills and say what they are set to. Where it is
              not — a phone, a tablet, or this same composer in the overlay's
              sidebar, which is 288px no matter how big the screen is — they
              collapse behind one control, because three pills beside the button
              that makes a picture is most of a narrow row spent on
              configuration. All three shells render and CSS picks one, so there
              is never a second trigger for the same thing on screen and never a
              second copy of the state.
            */}
            <ShotSettingsPills
              mode={mode}
              engineId={engineId}
              engineName={engineLabel}
              formatId={formatId}
              onFormat={setFormat}
              count={count}
              onCount={setVariants}
              quality={quality}
              onQuality={setQualityId}
              onCloseAutoFocus={backToBrief}
            />

            <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
              <Popover.Trigger>
                <button type="button" className="sc-var sc-more" aria-label={`Shot settings. ${settingsSummary}`}>
                  <SlidersHorizontal size={14} />
                  More
                </button>
              </Popover.Trigger>
              <Popover.Content
                className="sc-morepop"
                align="end"
                sideOffset={8}
                width="300px"
                onOpenAutoFocus={openOnGroup}
                onCloseAutoFocus={backToBrief}
              >
                <ShotSettingsFields
                  mode={mode}
                  engineId={engineId}
                  engineName={engineLabel}
                  formatId={formatId}
                  onFormat={setFormat}
                  count={count}
                  onCount={setVariants}
                  quality={quality}
                  onQuality={setQualityId}
                  // the engine select rides beside More in the overlay row now
                  // (the row wraps), so More holds only the shot's own settings
                />
              </Popover.Content>
            </Popover.Root>

            {/* the touch shell for the same fields: a sheet under the thumb */}
            <ShotSettings
              mode={mode}
              engineId={engineId}
              engineName={engineLabel}
              formatId={formatId}
              onFormat={setFormat}
              count={count}
              onCount={setVariants}
              quality={quality}
              onQuality={setQualityId}
            />

            <button
              type="button"
              className="sc-send"
              // aria-disabled: a native disabled button drops out of the tab
              // order, taking its title — often the one thing explaining why
              // — with it. go() already no-ops on !canGo, so this is purely
              // the accessible-name/keyboard-focus fix, not a new guard.
              aria-disabled={!canGo || undefined}
              onClick={() => void go()}
              aria-label={mode === 'edit' ? 'Refine' : 'Generate'}
              // A blocked button that will not say what blocks it is the least
              // helpful control on the screen. The comment above chose
              // aria-disabled precisely so this title could explain itself.
              title={err ?? templateFlag ?? blockedReason ?? `${mode === 'edit' ? 'Refine' : 'Generate'} (enter)`}
            >
              {/* One fixed slot for whichever of the two is showing. The
                  spinner is 12px and the arrow 17px, so swapping them resized
                  the button at the exact moment you had just pressed it. */}
              <span className="sc-send-ico">{busy ? <Spinner size="1" /> : <ArrowUp size={17} weight="bold" />}</span>
              {/* The one control whose meaning changes with the brief, and it
                  used to say so only in a tooltip: whether this makes a new
                  shot or continues an existing one is worth reading before
                  pressing, not after. Hidden by CSS where the row is tight. */}
              <span className="sc-send-lb">{mode === 'edit' ? 'Refine' : 'Generate'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
