import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { DropdownMenu, Select, Spinner } from '@radix-ui/themes';
import {
  ArrowUp,
  Crop,
  Gauge,
  Image as ImageIcon,
  Lightning,
  Package,
  Palette,
  Plus,
  Stack,
  UploadSimple,
} from '@phosphor-icons/react';
import {
  api,
  uploadImage,
  type Brand,
  type BriefPreview,
  type EngineInfo,
  type Look,
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
import { keepCaret } from '../composer/line.js';
import { openSettings } from '../views/SettingsDialog.js';
import { useProductLibrary } from '../useProductLibrary.js';

type QualityId = 'draft' | 'standard' | 'high';
/** Quality is the long edge we ask the engine for; aspect keeps the shape. */
const QUALITIES: { id: QualityId; label: string; edge: number; note: string }[] = [
  { id: 'draft', label: 'Draft', edge: 768, note: 'fast look-see' },
  { id: 'standard', label: 'Standard', edge: 1024, note: 'everyday shots' },
  { id: 'high', label: 'High', edge: 1536, note: 'print and hero use' },
];

export interface ComposerHandle {
  /** Append a token to the brief (assets panel click path). */
  insertToken: (t: SentenceToken) => void;
  /** Attach a look by id (assets panel click path). */
  applyTemplate: (id: string) => void;
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
    /** Home dock: no project yet; called on first submit to create one. */
    resolveProjectId?: () => Promise<string>;
    brand: Brand;
    engines: EngineInfo[];
    parent: TreeNode | null;
    shots: TreeNode[];
    initialBrief?: { tokens: BriefToken[]; templateId?: string; templateFields?: Record<string, string> } | null;
    /** Mono cost line under the card. On for docks, off inside the overlay. */
    costLine?: boolean;
    /** Template chosen before this project existed: seed it into the brief. */
    startTemplate?: string;
    /** Open the attach panel on this tab as soon as the composer mounts. */
    openAttachTab?: AttachTab;
    onQueued: () => void;
  }
>(function Composer(
  {
    projectId,
    resolveProjectId,
    brand,
    engines,
    parent,
    shots,
    initialBrief,
    costLine = true,
    startTemplate,
    openAttachTab,
    onQueued,
  },
  handleRef,
) {
  const libraryProducts = useProductLibrary(brand.id);
  const usable = engines.filter((e) => e.available);
  const [engineId, setEngineId] = useState('demo');
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
  const [formatId, setFormatId] = useState('square');
  const [templates, setTemplates] = useState<Look[]>([]);
  const [tplFields, setTplFields] = useState<Record<string, string>>({});
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<BriefPreview | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachTab, setAttachTab] = useState<AttachTab>('All');
  const [plusOpen, setPlusOpen] = useState(false);
  const [quality, setQuality] = useState<QualityId>('standard');
  const [uploading, setUploading] = useState(false);
  const briefRef = useRef<BriefInputHandle>(null);
  const attachRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api
      .looks()
      .then((r) => setTemplates(r.looks))
      .catch(() => {});
  }, []);

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

  const parentHasImage = !!parent && parent.status === 'done' && parent.images.length > 0;
  const engine = engines.find((e) => e.id === engineId);
  const mode: 'generation' | 'edit' = !template && parentHasImage && engine?.supportsEdit ? 'edit' : 'generation';
  // A template that wants a product still runs without one: it says "the
  // product" instead. Nine of ten templates ask for one, so blocking here
  // meant a brand with no products could never generate at all. Warn, allow.
  const blocking = preview?.warnings.filter((w) => w.includes('builds around a product')) ?? [];
  const canGo = !busy && hasContent;

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
    setPlusOpen(false);
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
    try {
      const pid = projectId ?? (resolveProjectId ? await resolveProjectId() : null);
      if (!pid) throw new Error('no project to generate into');
      const created = await api.addNode({
        projectId: pid,
        parentId: parent?.id ?? null,
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
      onQueued();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bt-composer">
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
        <div className="bt-banner">
          <Lightning size={15} />
          <span>
            {engineNote.title}
            <small>{engineNote.detail}</small>
          </span>
          <button type="button" className="bt-banner-act" onClick={() => openSettings('engines')}>
            Open settings
          </button>
        </div>
      )}
      <div className="bt-promptcard">
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
                : 'Describe the visual you want. @ for a product or someone, # for a look'
          }
          onSubmit={() => void go()}
        />

        <div className="bt-prompt-row">
          <div className="bt-prompt-left">
            <span className="bt-plus-wrap">
              <button
                type="button"
                ref={attachRef}
                className="bt-icon-btn bt-attach-toggle"
                aria-expanded={plusOpen || attachOpen}
                aria-label="Attach"
                title="Attach"
                onClick={() => {
                  if (attachOpen) {
                    setAttachOpen(false);
                    setPlusOpen(false);
                  } else setPlusOpen((v) => !v);
                }}
              >
                {uploading ? <Spinner size="1" /> : <Plus size={16} />}
              </button>
              {plusOpen && (
                <>
                  <span className="bt-plus-scrim" onClick={() => setPlusOpen(false)} aria-hidden />
                  <div className="bt-plusmenu" role="menu" onMouseDownCapture={keepCaret}>
                    <button type="button" role="menuitem" onClick={() => openAttach('Products')}>
                      <Package size={14} /> Product
                    </button>
                    <button type="button" role="menuitem" onClick={() => openAttach('Looks')}>
                      <Stack size={14} /> Look
                    </button>
                    <button type="button" role="menuitem" onClick={() => openAttach('Colors')}>
                      <Palette size={14} /> Brand color
                    </button>
                    <button type="button" role="menuitem" onClick={() => openAttach('Shots')}>
                      <ImageIcon size={14} /> Recent shot
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setPlusOpen(false);
                        fileRef.current?.click();
                      }}
                    >
                      <UploadSimple size={14} /> Upload image
                    </button>
                  </div>
                </>
              )}
            </span>

            <Select.Root value={engineId} onValueChange={setEngineId}>
              <Select.Trigger variant="ghost" className="bt-mini-sel">
                <Lightning size={14} />
                <span className="bt-mini-sel-t">{engine?.displayName ?? 'Demo'}</span>
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

          <div className="bt-prompt-right">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <button type="button" className="bt-var" aria-label={`Aspect ${ratio}`} title="Aspect ratio">
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
                  <button type="button" className="bt-var" aria-label={`${count} variants`} title="Variants">
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
                <button type="button" className="bt-var" aria-label={`Quality ${quality}`} title="Quality">
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

            <button
              type="button"
              className="bt-send"
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

      {costLine && (
        <div className="bt-composer-cost">
          {engine?.free
            ? `Free on ${engine.displayName}`
            : engine && engine.generationsLeft !== null
              ? `Costs ${count > 1 ? `${count} generations` : '1 generation'} · ${engine.generationsLeft} left`
              : engine
                ? `Uses your ${engine.displayName} key`
                : ''}
        </div>
      )}
    </div>
  );
});
