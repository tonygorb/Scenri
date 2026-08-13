import { Callout, Flex, ScrollArea, Spinner, Text } from '@radix-ui/themes';
import {
  MagicWand,
  Plus,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextT,
  TrashSimple,
} from '@phosphor-icons/react';
import { api, imgUrl, type Brand, type TextLayer, type TreeNode } from '../api.js';
import { ColorPicker } from './ColorPicker.js';
import { Confirm } from '../Confirm.js';
import { EDITOR_FONTS, fontById } from '../editor/fonts.js';
import { useToasts } from '../toasts.js';

export type InspectorTab = 'text' | 'info';

/** Text and Info panels for one shot. Lives inside the detail overlay. */
export function Inspector(props: {
  node: TreeNode | null;
  nodes: TreeNode[];
  imageIndex: number;
  onChanged: () => void;
  brand: Brand;
  layers: TextLayer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onLayersChange: (ls: TextLayer[]) => void;
  onAddLayer: () => void;
  onLift: () => void;
  lifting: boolean;
  tab: InspectorTab;
  onTabChange: (t: InspectorTab) => void;
  onExport: () => void;
  /** Omitted rather than disabled: there's nothing to diff against without a parent shot. */
  onCompare?: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const { node, tab, onTabChange } = props;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div className="sc-tabs">
        <button type="button" className="sc-tab" data-active={tab === 'text'} onClick={() => onTabChange('text')}>
          Text
        </button>
        <button type="button" className="sc-tab" data-active={tab === 'info'} onClick={() => onTabChange('info')}>
          Info
        </button>
      </div>
      {!node ? (
        <Flex align="center" justify="center" style={{ flex: 1 }} p="4">
          <Text size="1" style={{ color: 'var(--sc-fg3)', textAlign: 'center' }}>
            Pick a shot to add text or see its details.
          </Text>
        </Flex>
      ) : (
        <ScrollArea style={{ flex: 1 }}>
          <div style={{ padding: '14px 2px 14px 0' }}>
            {tab === 'text' ? <TextTab {...props} node={node} /> : <InfoTab {...props} node={node} />}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="sc-eyebrow" style={{ margin: '16px 0 7px' }}>
      {children}
    </div>
  );
}

function TextTab({
  node,
  brand,
  layers,
  selectedLayerId,
  onSelectLayer,
  onLayersChange,
  onAddLayer,
  onLift,
  lifting,
}: {
  node: TreeNode;
  brand: Brand;
  layers: TextLayer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onLayersChange: (ls: TextLayer[]) => void;
  onAddLayer: () => void;
  onLift: () => void;
  lifting: boolean;
}) {
  if (node.status !== 'done' || node.images.length === 0) {
    return (
      <Flex direction="column" gap="2" align="start">
        <Text size="1" style={{ color: 'var(--sc-fg3)', lineHeight: 1.5 }}>
          {node.status === 'error'
            ? 'This shot did not finish, so there is nothing to place text on. Try it again from the stage, or pick another shot.'
            : 'Text tools open the moment this shot lands.'}
        </Text>
      </Flex>
    );
  }
  const sel = layers.find((l) => l.id === selectedLayerId) ?? null;
  const update = (patch: Partial<TextLayer>) =>
    sel && onLayersChange(layers.map((l) => (l.id === sel.id ? { ...l, ...patch } : l)));
  const remove = () => {
    if (sel) {
      onLayersChange(layers.filter((l) => l.id !== sel.id));
      onSelectLayer(null);
    }
  };

  const p = brand.json?.palette;
  const swatches: string[] = [
    '#FFFFFF',
    '#111111',
    p?.primary?.hex,
    p?.secondary?.hex,
    ...(p?.accent ?? []).map((a: any) => a?.hex),
  ].filter(Boolean);
  const font = sel ? fontById(sel.fontId) : null;

  return (
    <>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="sc-btn sc-btn-primary"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={onAddLayer}
        >
          <Plus size={13} /> Add text
        </button>
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          style={{ flex: 1, justifyContent: 'center' }}
          aria-disabled={lifting || undefined}
          onClick={() => {
            if (!lifting) onLift();
          }}
          title="Turns text the AI painted into the image back into editable text"
        >
          {lifting ? (
            <Spinner size="1" />
          ) : (
            <>
              <MagicWand size={13} /> Make editable
            </>
          )}
        </button>
      </div>
      <Text size="1" style={{ color: 'var(--sc-fg3)', display: 'block', margin: '10px 0 14px', lineHeight: 1.5 }}>
        Drag text right on the image. If a shot came out with text baked in, one click turns it into editable text.
      </Text>

      {layers.length > 0 && (
        <div className="sc-layers">
          {layers.map((l) => (
            <button
              type="button"
              key={l.id}
              className="sc-lrow"
              data-active={l.id === selectedLayerId}
              onClick={() => onSelectLayer(l.id)}
            >
              <TextT size={13} />
              <span className="sc-lrow-t" dir="auto">
                {l.text.split('\n')[0] || '(empty)'}
              </span>
              {l.id === selectedLayerId && (
                <span
                  className="sc-lrow-x"
                  role="button"
                  aria-label="Remove layer"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove();
                  }}
                >
                  <TrashSimple size={12} />
                </span>
              )}
            </button>
          ))}
          <button type="button" className="sc-addlayer" onClick={onAddLayer}>
            <Plus size={11} /> Add text layer
          </button>
        </div>
      )}

      {sel && font && (
        <>
          <div className="sc-prop">
            <label>Font</label>
            <select
              className="sc-select"
              value={`${sel.fontId}|${sel.weight}`}
              onChange={(e) => {
                const [id, w] = e.target.value.split('|');
                update({ fontId: id, weight: Number(w) });
              }}
            >
              {EDITOR_FONTS.flatMap((f) =>
                f.weights.map((w) => (
                  <option key={`${f.id}|${w}`} value={`${f.id}|${w}`}>
                    {f.label} · {w}
                  </option>
                )),
              )}
            </select>
          </div>
          <div className="sc-prop">
            <label>Size</label>
            <input
              className="sc-range"
              type="range"
              min={16}
              max={220}
              value={sel.size}
              onChange={(e) => update({ size: Number(e.target.value) })}
              aria-label="Size"
            />
          </div>
          <div className="sc-prop">
            <label>Spacing</label>
            <input
              className="sc-range"
              type="range"
              min={0}
              max={30}
              value={sel.letterSpacing ?? 0}
              onChange={(e) => update({ letterSpacing: Number(e.target.value) })}
              aria-label="Letter spacing"
            />
          </div>
          <div className="sc-prop">
            <label>Line height</label>
            <input
              className="sc-range"
              type="range"
              min={80}
              max={200}
              value={sel.lineHeight * 100}
              onChange={(e) => update({ lineHeight: Number(e.target.value) / 100 })}
              aria-label="Line height"
            />
          </div>
          <div className="sc-prop">
            <label>Opacity</label>
            <input
              className="sc-range"
              type="range"
              min={10}
              max={100}
              value={sel.opacity * 100}
              onChange={(e) => update({ opacity: Number(e.target.value) / 100 })}
              aria-label="Opacity"
            />
          </div>
          <div className="sc-prop">
            <label>Align</label>
            <span className="sc-seg2">
              {(['left', 'center', 'right'] as const).map((a) => (
                <button
                  type="button"
                  key={a}
                  data-active={sel.align === a}
                  onClick={() => update({ align: a })}
                  aria-label={`Align ${a}`}
                >
                  {a === 'left' ? (
                    <TextAlignLeft size={13} />
                  ) : a === 'center' ? (
                    <TextAlignCenter size={13} />
                  ) : (
                    <TextAlignRight size={13} />
                  )}
                </button>
              ))}
            </span>
          </div>
          <div className="sc-prop">
            <label>Color</label>
            <Flex gap="1" align="center" wrap="wrap">
              {swatches.map((hex) => (
                <button
                  type="button"
                  key={hex}
                  className="sc-swatch"
                  data-active={sel.color.toLowerCase() === hex.toLowerCase()}
                  style={{ background: hex }}
                  onClick={() => update({ color: hex })}
                  aria-label={`Color ${hex}`}
                />
              ))}
              {/* The brand's own colours are the presets: a caption is nearly
                  always set in one of them, and the OS picker could not offer
                  them at all. */}
              <ColorPicker
                value={/^#[0-9a-fA-F]{6}$/.test(sel.color) ? sel.color : '#ffffff'}
                onChange={(hex) => update({ color: hex })}
                label="Custom color"
                presets={swatches}
                className="sc-swatch sc-swatch-custom"
              />
            </Flex>
          </div>

          <div className="sc-fx" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="sc-fxc"
              data-active={!!sel.uppercase}
              onClick={() => update({ uppercase: !sel.uppercase })}
            >
              Caps
            </button>
            <button
              type="button"
              className="sc-fxc"
              data-active={!!sel.shadow}
              onClick={() =>
                update({ shadow: sel.shadow ? null : { x: 0, y: 2, blur: 10, color: 'rgba(0,0,0,0.45)' } })
              }
            >
              Shadow
            </button>
            <button
              type="button"
              className="sc-fxc"
              data-active={!!sel.background}
              onClick={() =>
                update({
                  background: sel.background
                    ? null
                    : { color: 'rgba(0,0,0,0.65)', paddingX: 14, paddingY: 6, radius: 10 },
                })
              }
            >
              Pill background
            </button>
            <button
              type="button"
              className="sc-fxc"
              data-active={!!sel.stroke}
              onClick={() => update({ stroke: sel.stroke ? null : { color: '#111111', width: 3 } })}
            >
              Outline
            </button>
          </div>
        </>
      )}
    </>
  );
}

function InfoTab({
  node,
  onChanged,
  onExport,
  onCompare,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  node: TreeNode;
  onChanged: () => void;
  onExport: () => void;
  onCompare?: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const { push } = useToasts();

  return (
    <>
      <div className="sc-eyebrow">Brief</div>
      <Text size="1" style={{ display: 'block', lineHeight: 1.55, marginTop: 6, color: 'var(--sc-fg2)' }}>
        {node.prompt || '(none)'}
      </Text>
      <Flex gap="2" mt="3" wrap="wrap">
        <span className="sc-chip" style={{ cursor: 'default' }}>
          {node.kind === 'edit' ? 'Refinement' : 'Generation'}
        </span>
        <span className="sc-chip" style={{ cursor: 'default' }}>
          {node.engineId}
        </span>
        <span className="sc-chip" style={{ cursor: 'default' }}>
          {node.costUsd > 0 ? `$${node.costUsd.toFixed(3)}` : 'Free'}
        </span>
      </Flex>

      {node.status === 'done' && node.images.length > 0 && (
        <>
          <SectionLabel>Export</SectionLabel>
          <button type="button" className="sc-btn sc-btn-ghost" style={{ width: '100%' }} onClick={onExport}>
            Choose sizes
          </button>
        </>
      )}

      {onCompare && (
        <>
          <SectionLabel>Compare</SectionLabel>
          <button type="button" className="sc-btn sc-btn-ghost" style={{ width: '100%' }} onClick={onCompare}>
            Show what changed
          </button>
        </>
      )}

      {node.status === 'error' && (
        <Callout.Root color="red" mt="3" size="1">
          <Callout.Text>{node.error}</Callout.Text>
        </Callout.Root>
      )}
      <div style={{ height: 8 }} />
      <button
        type="button"
        className="sc-btn sc-btn-ghost"
        style={{ width: '100%' }}
        onClick={() =>
          void api
            .keep(node.id, !node.kept)
            .then(onChanged)
            .catch((e) =>
              push({ kind: 'error', title: 'Could not update keeper status', detail: String(e.message ?? e) }),
            )
        }
      >
        {node.kept ? 'Remove from keepers' : 'Mark as keeper'}
      </button>
      <button
        type="button"
        className="sc-btn sc-btn-ghost"
        style={{ width: '100%', marginTop: 6 }}
        onClick={() => (node.archived ? onUnarchive() : onArchive())}
      >
        {node.archived ? 'Restore this shot' : 'Archive this shot'}
      </button>
      {node.archived && (
        <div style={{ marginTop: 6 }}>
          <Confirm
            label="Delete this shot permanently"
            title="Delete this shot permanently?"
            body="This cannot be undone."
            busy={false}
            onConfirm={onDelete}
            fullWidth
          />
        </div>
      )}
    </>
  );
}
