import { useEffect, useMemo, useState } from 'react';
import { ImageSquare, MagnifyingGlass, UploadSimple, X } from '@phosphor-icons/react';
import { assetUrl, imgUrl, type Brand, type Look, type TreeNode } from '../api.js';
import { useProductLibrary } from '../useProductLibrary.js';
import type { SentenceToken } from './BriefInput.js';
import { keepCaret } from './line.js';

const ROLE_NAMES = ['Primary', 'Secondary', 'Accent', 'Accent 2', 'Neutral', 'Neutral 2'];
const TABS = ['All', 'Products', 'Cast', 'Looks', 'Colors', 'Shots'] as const;
export type AttachTab = (typeof TABS)[number];
type Tab = AttachTab;

interface Card {
  key: string;
  tab: Exclude<Tab, 'All'>;
  label: string;
  sub?: string;
  thumb?: string | null;
  swatch?: string;
  run: () => void;
}

/**
 * The big attach surface: opens above the composer at its full width.
 * Same data the sigil menus serve, browsable as thumbnail cards. Stays
 * open for multi-attach; Esc, X or outside click closes.
 */
export function AttachPanel({
  brand,
  templates,
  shots,
  initialTab = 'All',
  onToken,
  onTemplate,
  onUpload,
  onClose,
}: {
  brand: Brand;
  templates: Look[];
  shots: TreeNode[];
  initialTab?: AttachTab;
  onToken: (t: SentenceToken) => void;
  onTemplate: (id: string) => void;
  onUpload: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  const [q, setQ] = useState('');
  const library = useProductLibrary(brand.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        !(e.target as HTMLElement).closest('.sc-attachpanel') &&
        !(e.target as HTMLElement).closest('.sc-attach-toggle')
      )
        onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const cards = useMemo<Card[]>(() => {
    const products: any[] = library.length ? library : ((brand.json?.products ?? []) as any[]);
    const cast: any[] = (brand.json?.characters ?? []) as any[];
    const p = brand.json?.palette;
    const raw: { hex: string; name?: string }[] = [];
    const add = (c: any) => {
      if (c?.hex) raw.push({ hex: String(c.hex).toUpperCase(), name: c.name });
    };
    add(p?.primary);
    add(p?.secondary);
    (p?.accent ?? []).forEach(add);
    (p?.neutrals ?? []).forEach(add);
    const recent = shots
      .filter((s) => s.status === 'done' && s.images.length > 0)
      .slice(-12)
      .reverse();

    return [
      ...products.map(
        (pr): Card => ({
          key: `p:${pr.id}`,
          tab: 'Products',
          label: pr.name ?? 'Product',
          sub: 'stays exact',
          thumb: assetUrl(pr.shots?.[0]?.file),
          run: () => onToken({ t: 'product', id: pr.id }),
        }),
      ),
      ...cast.map(
        (c): Card => ({
          key: `h:${c.id}`,
          tab: 'Cast',
          label: c.name ?? 'Someone',
          sub: 'same person each time',
          thumb: assetUrl(c.shots?.[0]?.file),
          run: () => onToken({ t: 'character', id: c.id }),
        }),
      ),
      ...templates.map(
        (t): Card => ({
          key: `t:${t.id}`,
          tab: 'Looks',
          label: t.name,
          sub: t.lighting,
          thumb: (t as any).previewUrl ?? null,
          run: () => onTemplate(t.id),
        }),
      ),
      ...raw.map(
        (c, i): Card => ({
          key: `c:${c.hex}`,
          tab: 'Colors',
          label: c.name ?? ROLE_NAMES[i] ?? `Color ${i + 1}`,
          sub: c.hex,
          swatch: c.hex,
          run: () => onToken({ t: 'color', hex: c.hex, name: c.name ?? ROLE_NAMES[i] }),
        }),
      ),
      ...recent.map(
        (s, i): Card => ({
          key: `r:${s.id}`,
          tab: 'Shots',
          label: `Shot ${recent.length - i}`,
          sub: 'as reference',
          thumb: imgUrl(s.images[0]),
          run: () => onToken({ t: 'ref', imageHash: s.images[0] }),
        }),
      ),
    ];
  }, [brand, library, templates, shots, onToken, onTemplate]);

  const query = q.trim().toLowerCase();
  const match = (c: Card) => !query || `${c.label} ${c.sub ?? ''}`.toLowerCase().includes(query);
  const inTab = (c: Card) => tab === 'All' || c.tab === tab;
  const shown = cards.filter((c) => inTab(c) && match(c));
  const groups: Exclude<Tab, 'All'>[] = ['Products', 'Cast', 'Looks', 'Colors', 'Shots'];

  const card = (c: Card) => (
    <button type="button" key={c.key} className="sc-ap-card" title={c.label} onClick={c.run}>
      {c.swatch ? (
        <span className="sc-ap-thumb" style={{ background: c.swatch }} />
      ) : c.thumb ? (
        <img className="sc-ap-thumb" src={c.thumb} alt="" loading="lazy" />
      ) : (
        <span className="sc-ap-thumb sc-ap-thumb-empty">
          <ImageSquare size={16} />
        </span>
      )}
      <b dir="auto">{c.label}</b>
      {c.sub && <small>{c.sub}</small>}
    </button>
  );

  return (
    <div className="sc-attachpanel" role="dialog" aria-label="Attach to brief" onMouseDownCapture={keepCaret}>
      <div className="sc-ap-head">
        <div className="sc-ap-tabs">
          {TABS.map((t) => (
            <button type="button" key={t} data-active={t === tab} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="sc-ap-search">
          <MagnifyingGlass size={12} />
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button
          type="button"
          className="sc-icon-btn sc-ap-close"
          onClick={onUpload}
          aria-label="Upload image"
          title="Upload an image"
          style={{ width: 28, height: 28 }}
        >
          <UploadSimple size={12} />
        </button>
        <button
          type="button"
          className="sc-icon-btn sc-ap-close"
          onClick={onClose}
          aria-label="Close"
          style={{ width: 28, height: 28 }}
        >
          <X size={12} />
        </button>
      </div>

      <div className="sc-ap-body">
        {shown.length === 0 && <div className="sc-ap-empty">Nothing matches{query ? ` "${q.trim()}"` : ''}.</div>}
        {tab === 'All' ? (
          groups.map((g) => {
            const items = shown.filter((c) => c.tab === g);
            if (!items.length) return null;
            return (
              <div key={g} className="sc-ap-group">
                <div className="sc-eyebrow">{g === 'Shots' ? 'Recent shots' : g === 'Colors' ? 'Brand colors' : g}</div>
                <div className="sc-ap-grid">{items.map(card)}</div>
              </div>
            );
          })
        ) : (
          <div className="sc-ap-grid">{shown.map(card)}</div>
        )}
      </div>
    </div>
  );
}
