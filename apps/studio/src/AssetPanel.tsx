import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, Button, Callout, Card, Flex, Spinner, Text, TextField } from '@radix-ui/themes';
import { api, assetUrl, deleteAsset, uploadAsset, type Brand, type CatalogImportJob, type Product } from './api.js';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { CatalogImportDialog } from './layout/CatalogImportDialog.js';

/** Cards drawn at once. Past this, the search box above is the way through. */
const PANEL_CAP = 60;

/** Inline uploader and grid for a brand's product library. */
const SPEC = {
  key: 'products' as const,
  placeholder: 'Product name (e.g. House Blend 250g)',
  upload: '+ Upload shot',
  help: 'Import a store catalog, or upload clean packshots. Locked shots keep the product exact in every brief.',
  empty: 'No products yet.',
};

/** Imperative handle so a dialog wrapping this panel can drive focus from its own `onOpenAutoFocus` — the moment Radix actually settles focus, not a `useEffect` racing it. */
export interface ProductsPanelHandle {
  focusInitial: (which: 'upload' | 'import') => void;
}

export const ProductsPanel = forwardRef<
  ProductsPanelHandle,
  {
    brand: Brand;
    /** The id of a product just added, when a single manual upload just landed one — omitted for a bulk import or a removal, which have nothing single to insert. */
    onChanged: (newProductId?: string) => void;
    /** Auto-start a catalog import for this URL. */
    autoImportUrl?: string | null;
  }
>(function ProductsPanel({ brand, onChanged, autoImportUrl }, ref) {
  const spec = SPEC;
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importFieldRef = useRef<HTMLInputElement>(null);
  const nameFieldRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      focusInitial: (which) => (which === 'import' ? importFieldRef : nameFieldRef).current?.focus(),
    }),
    [],
  );
  const [library, setLibrary] = useState<Product[]>([]);
  const [importUrl, setImportUrl] = useState(autoImportUrl ?? brand.json?.meta?.website ?? '');
  const [job, setJob] = useState<CatalogImportJob | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const autoStarted = useRef(false);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const loadLibrary = async (): Promise<Product[]> => {
    try {
      const r = await api.productsLibrary(brand.id);
      setLibrary(r.products);
      return r.products;
    } catch (e: any) {
      setErr(String(e.message ?? e));
      return [];
    }
  };

  useEffect(() => {
    void loadLibrary();
  }, [brand.id, brand.updatedAt]);

  useEffect(() => {
    if (!autoImportUrl || autoStarted.current) return;
    autoStarted.current = true;
    void startImport(autoImportUrl);
  }, [autoImportUrl]);

  useEffect(() => {
    if (!job || !dialogOpen) return;
    const done = job.stage === 'completed' || job.stage === 'partial' || job.stage === 'failed';
    if (done) return;
    const t = setInterval(() => {
      void api
        .catalogJob(brand.id, job.id)
        .then(async (j) => {
          setJob(j);
          await loadLibrary();
          onChanged();
        })
        .catch(() => {});
    }, 700);
    return () => clearInterval(t);
  }, [job?.id, job?.stage, dialogOpen, brand.id]);

  const startImport = async (url: string) => {
    setErr(null);
    try {
      const { jobId } = await api.catalogImport(brand.id, url);
      const j = await api.catalogJob(brand.id, jobId);
      setJob(j);
      setDialogOpen(true);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  };

  const products: Product[] = library;
  /**
   * A catalog import can land hundreds, and this dialog drew all of them as
   * 120px cards with no way to find one. Filter first, then cap what is drawn,
   * and say plainly when there is more behind the cap.
   */
  const needle = filter.trim().toLowerCase();
  const matching = needle ? products.filter((p) => (p.name ?? '').toLowerCase().includes(needle)) : products;
  const visible = matching.slice(0, PANEL_CAP);

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    // uploadAsset returns the whole updated Brand, not the one new product in
    // productsLibrary's own shape — diff the library instead of trusting order
    const before = new Set(library.map((p) => p.id));
    try {
      await uploadAsset(brand.id, spec.key, file, name.trim() || file.name.replace(/\.[a-z]+$/i, ''));
      setName('');
      const fresh = await loadLibrary();
      onChanged(fresh.find((p) => !before.has(p.id))?.id);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (p: Product) => {
    try {
      if (p.origin === 'catalog' || p.id.startsWith('cat-')) {
        await api.deleteCatalogProduct(brand.id, p.id);
      } else {
        await deleteAsset(brand.id, spec.key, p.id);
      }
      await loadLibrary();
      onChanged();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  };

  return (
    <Flex direction="column" gap="2">
      <Flex gap="2" align="center">
        <TextField.Root
          ref={importFieldRef}
          style={{ flex: 1 }}
          placeholder="Store URL (shopify, woo, webflow…)"
          value={importUrl}
          onChange={(e) => setImportUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && importUrl.trim() && void startImport(importUrl.trim())}
        />
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          style={{ height: 32, flexShrink: 0 }}
          disabled={!importUrl.trim()}
          onClick={() => void startImport(importUrl.trim())}
        >
          {job && !job.finishedAt ? 'Importing…' : 'Import catalog'}
        </button>
      </Flex>
      <Flex
        gap="2"
        className="sc-upload-dz"
        data-drag-over={dragOver || undefined}
        onDragEnter={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return;
          e.preventDefault();
          dragDepth.current++;
          setDragOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragOver(false);
          const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
          if (!file) {
            setErr('Drop an image file.');
            return;
          }
          void upload(file);
        }}
      >
        <TextField.Root
          ref={nameFieldRef}
          style={{ flex: 1 }}
          placeholder={spec.placeholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
        />
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          style={{ height: 32, flexShrink: 0 }}
        >
          {busy ? <Spinner /> : spec.upload}
        </button>
      </Flex>
      <Text size="1" color="gray">
        {spec.help}
      </Text>
      {err && (
        <Callout.Root color="red" size="1">
          <Callout.Text>{err}</Callout.Text>
        </Callout.Root>
      )}
      {products.length > 12 && (
        <TextField.Root
          size="2"
          placeholder={`Search ${products.length} products`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <TextField.Slot>
            <MagnifyingGlass size={14} />
          </TextField.Slot>
        </TextField.Root>
      )}
      {matching.length === 0 && needle && (
        <Text size="1" color="gray">
          Nothing matches “{filter.trim()}”.
        </Text>
      )}
      <Flex gap="2" wrap="wrap">
        {visible.map((p) => {
          const url = assetUrl(p.shots?.[0]?.file);
          return (
            <Card key={p.id} variant="surface" style={{ width: 120 }}>
              <Flex direction="column" gap="1" align="center">
                {url ? (
                  <img src={url} alt={p.name} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6 }} />
                ) : (
                  <Box width="96px" height="96px" style={{ background: 'var(--gray-a4)', borderRadius: 6 }} />
                )}
                <Text size="1" truncate style={{ maxWidth: 100 }}>
                  {p.name}
                </Text>
                {p.origin === 'catalog' && (
                  <Text size="1" color="gray">
                    catalog
                  </Text>
                )}
                <Button
                  size="1"
                  variant="ghost"
                  color="red"
                  style={{ cursor: 'pointer' }}
                  onClick={() => void remove(p)}
                >
                  remove
                </Button>
              </Flex>
            </Card>
          );
        })}
        {products.length === 0 && (
          <Text size="1" color="gray">
            {spec.empty}
          </Text>
        )}
      </Flex>
      {matching.length > visible.length && (
        <Text size="1" color="gray">
          Showing {visible.length} of {matching.length}. Search to narrow it down.
        </Text>
      )}

      <CatalogImportDialog
        open={dialogOpen}
        job={job}
        productCount={library.length}
        onClose={() => setDialogOpen(false)}
        onContinue={() => setDialogOpen(false)}
        continueLabel="Done"
      />
    </Flex>
  );
});
