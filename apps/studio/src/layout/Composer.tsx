import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { DropdownMenu, Select, Spinner } from '@radix-ui/themes';
import { ArrowUp, Crop, Gauge, Lightning, Plus, Stack, X } from '@phosphor-icons/react';
import {
  api,
  imgUrl,
  nodeLabel,
  uploadImage,
  type Brand,
  type BriefPreview,
  type EngineInfo,
  type TextLayer,
  type TreeNode,
} from '../api.js';
import {
  BriefInput,
  emptySentence,
  FORMATS,
  type BriefInputHandle,
  type BriefToken,
  type SentenceToken,
} from '../composer/BriefInput.js';
import { AttachPanel, type AttachTab } from '../composer/AttachPanel.js';
import { QUALITIES, ShotSettings, type QualityId } from '../composer/ShotSettings.js';
import { useOpenSettings } from '../views/SettingsDialog.js';
import { useAppData } from '../app/AppShell.js';
import { PREF, useLocalPref } from '../prefs.js';
import { useProductLibrary } from '../useProductLibrary.js';

export interface ComposerHandle {
  /** Append a token to the brief (assets panel click path). */
  insertToken: (t: SentenceToken) => void;
  /** Attach a look by id (assets panel click path). */
  applyTemplate: (id: string) => void;
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
    initialBrief?: { tokens: BriefToken[]; templateId?: string; templateFields?: Record<string, string> } | null;
    /** Template chosen before this project existed: seed it into the brief. */
    startTemplate?: string;
    /** Open the attach panel on this tab as soon as the composer mounts. */
    openAttachTab?: AttachTab;
    /** The shot that was queued, so a caller filtered to a set can claim it. */
    onQueued: (nodeId?: string) => void;
    /**
     * A submit is in flight, with the prose of the brief that started it, so a
     * feed can stand something in for the shot before the server has answered.
     * Cleared here only on failure: on success the caller clears it once the
     * real shot has actually landed, or the tile would blink out and back in.
     */
    onSending?: (text: string | null) => void;
    /**
     * The shot this brief will branch from, chosen with Branch. Null means a
     * new shot, which is the resting state and the only other one there is.
     */
    target?: TreeNode | null;
    /** Given only where the target can be dropped, which is where it is shown. */
    onClearTarget?: () => void;
  }
>(function Composer(
  {
    projectId,
    brand,
    engines,
    parent,
    shots,
    initialBrief,
    startTemplate,
    openAttachTab,
    onQueued,
    onSending,
    target,
    onClearTarget,
  },
  handleRef,
) {
  const libraryProducts = useProductLibrary(brand.id);
  const { looks: templates } = useAppData();
  const openSettings = useOpenSettings();
  const usable = engines.filter((e) => e.available);
  const [engineId, setEngineId] = useLocalPref(PREF.engine, 'demo');
  useEffect(() => {
    if (!usable.some((e) => e.id === engineId)) setEngineId(usable[0]?.id ?? 'demo');
  }, [usable, engineId]);

  // Never invent a reason: the engine reports its own, or we say what Demo means.
  const selected = engines.find((e) => e.id === engineId);
  const engineNote =
    selected && !selected.available
      ? { title: `${selected.displayName} is not ready`, detail: selected.reason ?? 'Connect it in Settings.' }
      : usable.length === 1 && usable[0]?.id === 'demo'
        ? {
            title: 'No engine connected',
            detail: 'Falling back to Demo. Generations are placeholders until an engine is connected.',
          }
        : null;

  const [sentence, setSentence] = useState<SentenceToken[]>(emptySentence());
  const [seedTokens, setSeedTokens] = useState<SentenceToken[] | undefined>(undefined);
  const [formatId, setFormatId] = useLocalPref(PREF.format, 'square');
  const [tplFields, setTplFields] = useState<Record<string, string>>({});
  const [count, setCount] = useLocalPref(PREF.count, 2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<BriefPreview | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachTab, setAttachTab] = useState<AttachTab>('All');
  const [quality, setQuality] = useLocalPref<QualityId>(PREF.quality, 'standard');
  const [uploading, setUploading] = useState(false);
  const briefRef = useRef<BriefInputHandle>(null);
  const attachRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // a template picked on Home, or "New photoshoot", lands here once
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    if (startTemplate) {
      seeded.current = true;
      setSeedTokens([
        { t: 'template', id: startTemplate },
        { t: 'text', v: ' ' },
      ]);
    } else if (openAttachTab) {
      seeded.current = true;
      setAttachTab(openAttachTab);
      setAttachOpen(true);
    }
  }, [startTemplate, openAttachTab]);

  useImperativeHandle(handleRef, () => ({
    insertToken: (t) => briefRef.current?.insert(t),
    applyTemplate: (id) => briefRef.current?.insert({ t: 'template', id }),
    openAttach: (tab) => openAttach(tab),
    focus: () => briefRef.current?.focus(),
    submit: () => {
      void go();
    },
  }));

  useEffect(() => {
    if (!initialBrief) return;
    // a stored brief carries its size too: lift it back out of the sentence
    const all = (initialBrief.tokens ?? []) as BriefToken[];
    const carriedFormat = all.find((t) => t.t === 'format') as Extract<BriefToken, { t: 'format' }> | undefined;
    if (carriedFormat) setFormatId(carriedFormat.id);
    const carried = all.filter((t): t is SentenceToken => t.t !== 'format');
    const body = carried.length ? carried : emptySentence();
    // legacy shots carry templateId; lift it into a token so the chip shows up
    const hasTemplateToken = body.some((t) => t.t === 'template');
    setSeedTokens(
      initialBrief.templateId && !hasTemplateToken ? [{ t: 'template', id: initialBrief.templateId }, ...body] : body,
    );
    setTplFields(initialBrief.templateFields ?? {});
  }, [initialBrief]);

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
    const edge = QUALITIES.find((x) => x.id === quality)?.edge ?? 1024;
    const scale = edge / Math.max(f.w, f.h);
    const round8 = (n: number) => Math.max(256, Math.round((n * scale) / 8) * 8);
    return { t: 'format' as const, id: f.id, w: round8(f.w), h: round8(f.h) };
  }, [formatId, quality]);

  const tokens = useMemo<BriefToken[]>(() => [format, ...sentence], [format, sentence]);
  const brief = useMemo(() => ({ tokens, templateFields: tplFields }), [tokens, tplFields]);
  const hasContent = sentence.some((t) => (t.t === 'text' ? !!t.v.trim() : true));
  /** The template now lives in the sentence, so read it back from the tokens. */
  const template = useMemo(() => {
    const tok = sentence.find((t) => t.t === 'template') as Extract<SentenceToken, { t: 'template' }> | undefined;
    return tok ? (templates.find((x) => x.id === tok.id) ?? null) : null;
  }, [sentence, templates]);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hasContent) {
      setPreview(null);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      void api
        .previewBrief(brief, engineId, brand.id)
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 280);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [brief, engineId, brand.id, hasContent]);

  const engine = engines.find((e) => e.id === engineId);

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
   *  - a look is a fresh setup, so it starts a new shot by definition
   */
  const branchable = target && target.kind !== 'root' && target.status === 'done' && target.images.length > 0;
  const engineCanEdit = !!engine?.supportsEdit;
  const mode: 'generation' | 'edit' = branchable && engineCanEdit ? 'edit' : 'generation';
  const targetNote =
    branchable && !engineCanEdit ? `${engine?.displayName ?? 'This engine'} cannot edit. This makes a new shot.` : null;

  /**
   * A look is a fresh setup, so it cannot also be an edit of an existing shot.
   * Rather than explain that in a sentence nobody asked for, the branch simply
   * lets go: the look chip appears and the branch chip disappears, which is the
   * same fact told in the place you are already looking.
   */
  useEffect(() => {
    if (template && branchable && onClearTarget) onClearTarget();
  }, [template, branchable, onClearTarget]);
  // A template that wants a product still runs without one: it says "the
  // product" instead. Nine of ten templates ask for one, so blocking here
  // meant a brand with no products could never generate at all. Warn, allow.
  const blocking = preview?.warnings.filter((w) => w.includes('builds around a product')) ?? [];
  // the workspace arrives a beat after the screen does, and typing is faster
  // than a round trip: without this the first brief of a cold load could be sent
  // into nothing and come back as an error the user did nothing to cause
  const canGo = !busy && hasContent && !!projectId;

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
  const ratio = useMemo(() => {
    const w = format.w ?? preview?.width ?? 1024;
    const h = format.h ?? preview?.height ?? 1024;
    const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
    const d = g(w, h) || 1;
    return `${w / d}:${h / d}`;
  }, [format, preview]);

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
    setUploading(true);
    setErr(null);
    try {
      for (const f of Array.from(files).slice(0, 4)) {
        const hash = await uploadImage(f);
        // the same caret-aware insert every other pick uses: appending through
        // state repainted the line while focus was on the file dialog, which
        // dropped the caret and left the brief untypeable
        briefRef.current?.insert({ t: 'ref', imageHash: hash });
      }
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // warnings live ON the affected chip, not as sentences in the card
  const templateFlag = template && blocking.length > 0 ? 'This template builds around a product. Attach one.' : null;
  const flagToken = (t: BriefToken): string | null => {
    if (t.t === 'template') return templateFlag;
    if (!preview) return null;
    if (t.t === 'ref' && !preview.attachments.some((a) => a.hash === t.imageHash)) {
      return `${engine?.displayName ?? 'This engine'} cannot read this reference, so it is left out.`;
    }
    if (t.t === 'product') {
      const products = libraryProducts.length ? libraryProducts : (brand.json?.products ?? []);
      const p = products.find((x: any) => x.id === t.id);
      if (p && !preview.attachments.some((a) => a.role === 'product' && a.label === p.name)) {
        return `${engine?.displayName ?? 'This engine'} cannot read the product image, so ${p.name} rides as text only.`;
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
    onSending?.(said || 'Your shot');
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
      });
      if (template?.textZones?.length && mode === 'generation') {
        const overlays: Record<string, TextLayer[]> = {};
        for (let i = 0; i < count; i++) {
          overlays[String(i)] = template.textZones.map((z, zi) => ({
            id: `l-${Math.random().toString(36).slice(2, 8)}${zi}`,
            text:
              (tplFields[z.fieldKey] ?? '').trim() ||
              (template.fields ?? [])
                .find((f) => f.key === z.fieldKey)
                ?.placeholder?.split('/')[0]
                ?.trim() ||
              'Headline',
            x: z.x,
            y: z.y,
            width: z.width,
            size: z.size,
            fontId: 'inter-tight',
            weight: z.weightHint ?? 700,
            color: '#FFFFFF',
            align: z.align,
            lineHeight: 1.08,
            opacity: 1,
            shadow: { x: 0, y: 2, blur: 10, color: 'rgba(0,0,0,0.45)' },
          }));
        }
        await api.saveOverlays(created.id, overlays);
      }
      briefRef.current?.setTokens(emptySentence());
      setTplFields({});
      onQueued(created.id);
    } catch (e: any) {
      setErr(String(e.message ?? e));
      // the brief is deliberately not cleared above until the shot exists, so
      // everything typed is still on screen to send again
      onSending?.(null);
    } finally {
      setBusy(false);
    }
  };

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

      {attachOpen && (
        <AttachPanel
          brand={brand}
          templates={templates}
          shots={shots}
          initialTab={attachTab}
          onUpload={() => fileRef.current?.click()}
          onToken={(t) => briefRef.current?.insert(t)}
          onTemplate={(id) => briefRef.current?.insert({ t: 'template', id })}
          onClose={() => setAttachOpen(false)}
        />
      )}
      {engineNote && (
        <div className="sc-banner">
          <Lightning size={15} />
          <span>
            {engineNote.title}
            <small>{engineNote.detail}</small>
          </span>
          <button type="button" className="sc-banner-act" onClick={() => openSettings('engines')}>
            Open settings
          </button>
        </div>
      )}
      <div className="sc-promptcard">
        {/* What this brief is about to do, stated before it does it. Only the
            hub can drop a target, so only the hub shows the chip: inside the
            overlay the shot being refined is the whole screen. */}
        {branchable && onClearTarget && (
          <div className="sc-target" data-note={targetNote ? '' : undefined}>
            <span className="sc-target-lb">
              Branching from
              <img src={imgUrl(target.images[0])} alt="" />
              <b dir="auto">{nodeLabel(target)}</b>
            </span>
            {targetNote && <small className="sc-target-note">{targetNote}</small>}
            <button type="button" className="sc-target-x" onClick={onClearTarget} aria-label="Make a new shot instead">
              <X size={12} />
            </button>
          </div>
        )}
        <BriefInput
          ref={briefRef}
          onChange={setSentence}
          brand={brand}
          shots={shots}
          templates={templates}
          flag={flagToken}
          placeholder={
            template
              ? 'Add art direction, or run it as written'
              : mode === 'edit'
                ? 'Refine this shot, or describe a new one'
                : 'What should we shoot? (use / to insert, @ for a product, # for a look)'
          }
          placeholderSm={template || mode === 'edit' ? undefined : 'What should we shoot? (use / @ #)'}
          onSubmit={() => void go()}
        />

        <div className="sc-prompt-row">
          <div className="sc-prompt-left">
            {/* One click, not two.

                This used to open a menu naming five kinds, and picking one
                opened a panel that already had those same five as tabs. The
                menu was a question the panel then asked again, so it is gone
                and the panel opens on All. The kinds are still one click away,
                as its tabs, and `@` and `#` still open the same list inline at
                the caret for anyone who would rather not leave the keyboard. */}
            <button
              type="button"
              ref={attachRef}
              className="sc-icon-btn sc-attach-toggle"
              aria-expanded={attachOpen}
              aria-label="Attach"
              title="Attach a product, a look, a colour or an image"
              onClick={() => (attachOpen ? setAttachOpen(false) : openAttach('All'))}
            >
              {uploading ? <Spinner size="1" /> : <Plus size={16} />}
            </button>

            <Select.Root value={engineId} onValueChange={setEngineId}>
              <Select.Trigger variant="ghost" className="sc-mini-sel">
                <Lightning size={14} />
                <span className="sc-mini-sel-t">{engine?.displayName ?? 'Demo'}</span>
              </Select.Trigger>
              <Select.Content>
                {usable.map((e) => (
                  <Select.Item key={e.id} value={e.id}>
                    {e.displayName}
                  </Select.Item>
                ))}
                {usable.length === 0 && <Select.Item value="demo">Demo</Select.Item>}
              </Select.Content>
            </Select.Root>
          </div>

          <div className="sc-prompt-right">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <button type="button" className="sc-var" aria-label={`Aspect ${ratio}`} title="Aspect ratio">
                  <Crop size={14} />
                  {ratio}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" onCloseAutoFocus={backToBrief}>
                {FORMATS.map((f) => (
                  <DropdownMenu.Item key={f.id} onSelect={() => setFormat(f.id)}>
                    {f.label} · {f.hint}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>

            {mode === 'generation' && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <button type="button" className="sc-var" aria-label={`${count} variants`} title="Variants">
                    <Stack size={14} />
                    {count}v
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end" onCloseAutoFocus={backToBrief}>
                  {[1, 2, 3, 4].map((n) => (
                    <DropdownMenu.Item key={n} onSelect={() => setVariants(n)}>
                      {n} variant{n === 1 ? '' : 's'}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            )}

            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <button type="button" className="sc-var" aria-label={`Quality ${quality}`} title="Quality">
                  <Gauge size={14} />
                  {QUALITIES.find((q) => q.id === quality)?.label}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" onCloseAutoFocus={backToBrief}>
                {QUALITIES.map((q) => (
                  <DropdownMenu.Item key={q.id} onSelect={() => setQualityId(q.id)}>
                    {q.label} · {q.edge}px · {q.note}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>

            {/* the phone's stand-in for the three pills above: CSS picks one */}
            <ShotSettings
              mode={mode}
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
              disabled={!canGo}
              onClick={() => void go()}
              aria-label={mode === 'edit' ? 'Refine' : 'Generate'}
              title={err ?? templateFlag ?? `${mode === 'edit' ? 'Refine' : 'Generate'} (enter)`}
            >
              {busy ? <Spinner size="1" /> : <ArrowUp size={17} weight="bold" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
