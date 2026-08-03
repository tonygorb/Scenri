import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Dialog, DropdownMenu, Flex } from '@radix-ui/themes';
import { CaretDown, ImageSquare, Package, Sparkle, Star, UsersThree, WarningCircle } from '@phosphor-icons/react';
import { api, imgUrl, type Brand, type EngineInfo, type Project, type Look, type TreeNode } from '../api.js';
import { TopBar, Wordmark, type NavItem } from '../layout/TopBar.js';
import { Composer } from '../layout/Composer.js';
import { ProductsPanel } from '../AssetPanel.js';
import { favoriteLooks } from '../favorites.js';

interface FeedItem {
  node: TreeNode;
  hash: string | null;
  projectId: string;
  projectName: string;
}

export function HomeView({
  brand,
  brands,
  engines,
  nav,
  onSelectBrand,
  onOpenProject,
  onLooks,
  onSetup,
  settingsButton,
  onBrandChanged,
}: {
  brand: Brand;
  brands: Brand[];
  engines: EngineInfo[];
  onSelectBrand: (id: string) => void;
  onOpenProject: (id: string, opts?: { startTemplate?: string; openTemplates?: boolean }) => void;
  nav: NavItem[];
  onLooks: () => void;
  onSetup: () => void;
  settingsButton: React.ReactNode;
  onBrandChanged: () => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const [templates, setTemplates] = useState<Look[]>([]);
  const [tab, setTab] = useState<string>('all');
  const dockProject = useRef<string | null>(null);

  useEffect(() => {
    void api
      .looks()
      .then((r) => setTemplates(r.looks))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await api.projects(brand.id);
      if (!alive) return;
      setProjects(list);
      const trees = await Promise.all(
        list.map(async (p) => {
          try {
            return { p, nodes: (await api.tree(p.id)).nodes };
          } catch {
            return { p, nodes: [] as TreeNode[] };
          }
        }),
      );
      if (!alive) return;
      const items: FeedItem[] = trees
        .flatMap(({ p, nodes }) =>
          nodes
            .filter((n) => n.kind !== 'root')
            .map((n) => ({ node: n, hash: n.images[0] ?? null, projectId: p.id, projectName: p.name })),
        )
        .sort((a, b) => b.node.createdAt.localeCompare(a.node.createdAt));
      setFeed(items);
    })();
    return () => {
      alive = false;
    };
  }, [brand.id]);

  const newProject = async (opts?: { startTemplate?: string; openTemplates?: boolean }) => {
    const created = await api.createProject(brand.id, `Project ${(projects?.length ?? 0) + 1}`);
    onOpenProject(created.project.id, opts);
    return created.project.id;
  };

  const palette = [
    brand.json?.palette?.primary?.hex,
    brand.json?.palette?.secondary?.hex,
    ...(brand.json?.palette?.accent ?? []).map((a: any) => a?.hex),
  ].filter(Boolean) as string[];
  const products = (brand.json?.products ?? []) as any[];
  const brandName: string = brand.json?.meta?.name ?? brand.slug;

  const shown = useMemo(() => {
    if (!feed) return null;
    if (tab === 'all') return feed;
    if (tab === 'keepers') return feed.filter((f) => f.node.kept);
    return feed.filter((f) => f.projectId === tab);
  }, [feed, tab]);

  const doneShots = useMemo(
    () => (feed ?? []).map((f) => f.node).filter((n) => n.status === 'done' && n.images.length > 0),
    [feed],
  );

  return (
    <div className="bt-home">
      <TopBar
        engines={engines}
        nav={nav}
        left={
          <Flex align="center" gap="3">
            <Wordmark />
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <button type="button" className="bt-brand-pill">
                  <span className="bt-brand-dot" style={{ background: palette[0] ?? 'var(--bt-fg3)' }} />
                  <span dir="auto" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {brandName}
                  </span>
                  <CaretDown size={11} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {brands.map((b) => (
                  <DropdownMenu.Item key={b.id} onSelect={() => onSelectBrand(b.id)}>
                    {b.json?.meta?.name ?? b.slug}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={onSetup}>Set up a brand</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </Flex>
        }
        right={settingsButton}
      />

      <main className="bt-main">
        <h1 className="bt-greet">
          Make something <em>on brand</em>
        </h1>

        <div className="bt-create-grid">
          <button type="button" className="bt-create-card" onClick={() => void newProject({ openTemplates: true })}>
            <span className="bt-glyph">
              <Sparkle size={16} />
            </span>
            <span>
              <b>New photoshoot</b>
              <small>Template plus your product</small>
            </span>
          </button>
          <button type="button" className="bt-create-card" onClick={() => void newProject()}>
            <span className="bt-glyph">
              <ImageSquare size={16} />
            </span>
            <span>
              <b>Start from scratch</b>
              <small>Describe any visual</small>
            </span>
          </button>
          <ProductsCard brand={brand} onChanged={onBrandChanged} count={products.length} />
          <button type="button" className="bt-create-card" onClick={onSetup}>
            <span className="bt-glyph">
              <UsersThree size={16} />
            </span>
            <span>
              <b>Set up a brand</b>
              <small>Kit from a URL in a minute</small>
            </span>
          </button>
        </div>

        {templates.length > 0 && (
          <>
            <div className="bt-sec-head">
              <span className="bt-sec-title">Looks</span>
              <button type="button" className="bt-sec-more" onClick={onLooks}>
                All looks
              </button>
            </div>
            <div className="bt-tplrow">
              {[...templates]
                .sort((a, b) => {
                  const favs = favoriteLooks(brand.id);
                  return Number(favs.includes(b.id)) - Number(favs.includes(a.id));
                })
                .map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className="bt-tpl"
                    onClick={() => void newProject({ startTemplate: t.id })}
                    title={t.description}
                  >
                    {(t as any).previewUrl ? (
                      <img src={(t as any).previewUrl} alt="" />
                    ) : (
                      <span className="bt-tpl-ph">
                        <ImageSquare size={20} />
                      </span>
                    )}
                    <span className="bt-tpl-m">
                      <b>{t.name}</b>
                      <small>{t.lighting}</small>
                    </span>
                  </button>
                ))}
            </div>
          </>
        )}

        <div className="bt-tabs" style={{ background: 'none' }}>
          <button type="button" className="bt-tab" data-active={tab === 'all'} onClick={() => setTab('all')}>
            All
          </button>
          <button type="button" className="bt-tab" data-active={tab === 'keepers'} onClick={() => setTab('keepers')}>
            Keepers
          </button>
          {(projects ?? []).slice(0, 8).map((p) => (
            <button type="button" key={p.id} className="bt-tab" data-active={tab === p.id} onClick={() => setTab(p.id)}>
              {p.name}
            </button>
          ))}
        </div>

        {shown === null && (
          <div className="bt-feed">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div
                key={i}
                className="bt-cell bt-skeleton"
                style={{ aspectRatio: i % 3 === 0 ? '4/5' : '1', cursor: 'default' }}
              />
            ))}
          </div>
        )}

        {shown !== null && shown.length === 0 && (
          <div className="bt-feed-empty">
            {feed?.length === 0
              ? 'Nothing on the feed yet. Describe the first shot below.'
              : 'Nothing here. Star a shot to make it a keeper.'}
          </div>
        )}

        {shown !== null && shown.length > 0 && (
          <div className="bt-feed">
            {shown.map((f) => {
              const n = f.node;
              if (n.status === 'running') {
                return (
                  <div key={n.id} className="bt-cell" data-running="true">
                    <span className="bt-shimmer" />
                    <span className="bt-cell-tag">generating</span>
                  </div>
                );
              }
              if (n.status === 'error' || !f.hash) {
                return (
                  <button
                    type="button"
                    key={n.id}
                    className="bt-cell"
                    data-failed="true"
                    onClick={() => onOpenProject(f.projectId)}
                  >
                    <span className="bt-cell-failed">
                      <WarningCircle size={16} />
                      Failed
                    </span>
                  </button>
                );
              }
              return (
                <button type="button" key={n.id} className="bt-cell" onClick={() => onOpenProject(f.projectId)}>
                  <img src={imgUrl(f.hash)} alt="" loading="lazy" />
                  {n.kept && (
                    <span className="bt-cell-star">
                      <Star size={14} weight="fill" />
                    </span>
                  )}
                  <span className="bt-cell-meta">{f.projectName}</span>
                </button>
              );
            })}
          </div>
        )}
      </main>

      <div className="bt-dock-fade" aria-hidden />
      <div className="bt-home-dock">
        <Composer
          projectId={null}
          resolveProjectId={async () => {
            const created = await api.createProject(brand.id, `Project ${(projects?.length ?? 0) + 1}`);
            dockProject.current = created.project.id;
            return created.project.id;
          }}
          brand={brand}
          engines={engines}
          parent={null}
          shots={doneShots}
          onQueued={() => {
            if (dockProject.current) onOpenProject(dockProject.current);
          }}
        />
      </div>
    </div>
  );
}

function ProductsCard({ brand, onChanged, count }: { brand: Brand; onChanged: () => void; count: number }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <button type="button" className="bt-create-card">
          <span className="bt-glyph">
            <Package size={16} />
          </span>
          <span>
            <b>
              Add a product{' '}
              {count > 0 && (
                <Badge variant="soft" radius="full" size="1">
                  {count}
                </Badge>
              )}
            </b>
            <small>Locked shots keep it exact</small>
          </span>
        </button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>Products: {brand.json?.meta?.name}</Dialog.Title>
        <ProductsPanel brand={brand} onChanged={onChanged} />
      </Dialog.Content>
    </Dialog.Root>
  );
}
