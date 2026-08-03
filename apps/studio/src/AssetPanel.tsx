import { useEffect, useRef, useState } from 'react';
import { Box, Button, Callout, Card, Flex, Spinner, Text, TextField } from '@radix-ui/themes';
import { api, assetUrl, deleteAsset, uploadAsset, type Brand, type CatalogImportJob, type Product } from './api.js';
import { CatalogImportDialog } from './layout/CatalogImportDialog.js';

/** Inline uploader and grid. One panel, two collections: products and cast. */
const KINDS = {
  products: {
    key: 'products' as const,
    placeholder: 'Product name (e.g. House Blend 250g)',
    upload: '+ Upload shot',
    help: 'Import a store catalog, or upload clean packshots. Locked shots keep the product exact in every brief.',
    empty: 'No products yet.',
  },
  characters: {
    key: 'characters' as const,
    placeholder: 'Who is this? (e.g. Marco)',
    upload: '+ Upload photo',
    help: 'A named person you can put in a brief with @. We attach their photo as a reference, so they stay recognisably the same person. We do not train a model of them.',
    empty: 'Nobody in the cast yet.',
  },
};

export function ProductsPanel({
  brand,
  onChanged,
  kind = 'products',
  autoImportUrl,
}: {
  brand: Brand;
  onChanged: () => void;
  kind?: keyof typeof KINDS;
  /** When set (products only), auto-start a catalog import for this URL. */
  autoImportUrl?: string | null;
}) {
  const spec = KINDS[kind];
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState<Product[]>([]);
  const [importUrl, setImportUrl] = useState(autoImportUrl ?? brand.json?.meta?.website ?? '');
  const [job, setJob] = useState<CatalogImportJob | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const autoStarted = useRef(false);

  const loadLibrary = async () => {
    if (kind !== 'products') return;
    try {
      const r = await api.productsLibrary(brand.id);
      setLibrary(r.products);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (kind === 'products') void loadLibrary();
  }, [brand.id, brand.updatedAt, kind]);

  useEffect(() => {
    if (kind !== 'products' || !autoImportUrl || autoStarted.current) return;
    autoStarted.current = true;
    void startImport(autoImportUrl);
  }, [autoImportUrl, kind]);

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

  const manualProducts: Product[] = ((brand.json as any)?.[spec.key] ?? []) as Product[];
  const products: Product[] = kind === 'products' ? library : manualProducts;

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      await uploadAsset(brand.id, spec.key, file, name.trim() || file.name.replace(/\.[a-z]+$/i, ''));
      setName('');
      await loadLibrary();
      onChanged();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (p: Product) => {
    if (p.origin === 'catalog' || p.id.startsWith('cat-')) {
      await api.deleteCatalogProduct(brand.id, p.id);
    } else {
      await deleteAsset(brand.id, spec.key, p.id);
    }
    await loadLibrary();
    onChanged();
  };

  return (
    <Flex direction="column" gap="2">
      {kind === 'products' && (
        <Flex gap="2" align="center">
          <TextField.Root
            style={{ flex: 1 }}
            placeholder="Store URL (shopify, woo, webflow…)"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && importUrl.trim() && void startImport(importUrl.trim())}
          />
          <button
            type="button"
            className="bt-btn bt-btn-ghost"
            style={{ height: 32, flexShrink: 0 }}
            disabled={!importUrl.trim()}
            onClick={() => void startImport(importUrl.trim())}
          >
            {job && !job.finishedAt ? 'Importing…' : 'Import catalog'}
          </button>
        </Flex>
      )}
      <Flex gap="2">
        <TextField.Root
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
          className="bt-btn bt-btn-ghost"
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
      <Flex gap="2" wrap="wrap">
        {products.map((p) => {
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

      {kind === 'products' && (
        <CatalogImportDialog
          open={dialogOpen}
          job={job}
          productCount={library.length}
          onClose={() => setDialogOpen(false)}
          onContinue={() => setDialogOpen(false)}
          continueLabel="Done"
        />
      )}
    </Flex>
  );
}
