import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Outlet, ScrollRestoration, useSearchParams } from 'react-router';
import { Callout, Flex, Spinner } from '@radix-ui/themes';
import { api, type Brand, type EngineInfo, type Presenter } from '../api.js';
import { useScenes, type UseScenesResult } from '../useScenes.js';
import { usePresenters } from '../usePresenters.js';

// usePresenters and useScenes both expose `loaded`/`error`/`refetch` — spreading
// both into one context would let whichever lands second silently win for
// existing Scenes consumers. Namespaced instead, so both stay independently
// readable.
interface AppData extends UseScenesResult {
  brands: Brand[];
  engines: EngineInfo[];
  presenters: Presenter[];
  presenterCategories: string[];
  presenterStyles: string[];
  presentersLoaded: boolean;
  presentersError: boolean;
  refetchPresenters: () => void;
  /** Re-read brands and engines: brand edits and key changes both land here. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const value = useContext(Ctx);
  if (!value) throw new Error('useAppData must be used inside AppShell');
  return value;
}

/**
 * The one thing mounted under every URL. It owns what the whole app needs to
 * exist at all: brands, engines and the scene catalog. The dialogs sit a level
 * down in BrandLayout, since both of them are about a brand's projects.
 */
export function AppShell() {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scenes = useScenes();
  const presenters = usePresenters();

  const refresh = useCallback(async () => {
    try {
      const [b, e] = await Promise.all([api.brands(), api.engines()]);
      setBrands(b);
      setEngines(e);
    } catch (err: any) {
      setError(String(err.message ?? err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) {
    return (
      <Flex align="center" justify="center" height="100vh">
        <Callout.Root color="red">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      </Flex>
    );
  }
  if (brands === null) {
    return (
      <Flex align="center" justify="center" height="100vh">
        <Spinner size="3" />
      </Flex>
    );
  }

  return (
    <Ctx.Provider
      value={{
        brands,
        engines,
        ...scenes,
        presenters: presenters.presenters,
        presenterCategories: presenters.categories,
        presenterStyles: presenters.styles,
        presentersLoaded: presenters.loaded,
        presentersError: presenters.error,
        refetchPresenters: presenters.refetch,
        refresh,
      }}
    >
      <ScrollRestoration />
      <Outlet />
    </Ctx.Provider>
  );
}

/**
 * Settings and the project picker are detours, not destinations, but they still
 * survive a refresh and answer to Back. Opening pushes an entry so Back closes
 * the dialog; closing replaces, so Back then leaves the screen rather than
 * reopening what you just dismissed.
 */
export function useDialogParam(name: string) {
  const [params, setParams] = useSearchParams();
  const value = params.get(name);

  const open = useCallback(
    (next: string) => {
      setParams(
        (cur) => {
          const p = new URLSearchParams(cur);
          p.set(name, next);
          return p;
        },
        { replace: false },
      );
    },
    [name, setParams],
  );

  /** Moving around inside an open dialog is not a new destination. */
  const set = useCallback(
    (next: string) => {
      setParams(
        (cur) => {
          const p = new URLSearchParams(cur);
          p.set(name, next);
          return p;
        },
        { replace: true },
      );
    },
    [name, setParams],
  );

  const close = useCallback(() => {
    setParams(
      (cur) => {
        const p = new URLSearchParams(cur);
        p.delete(name);
        return p;
      },
      { replace: true },
    );
  }, [name, setParams]);

  return { value, open, set, close };
}

/**
 * A filter is not a destination. It survives a refresh and travels in a pasted
 * link, but it replaces rather than piling up entries, so Back still means the
 * screen before this one. The default drops out of the URL entirely.
 */
export function useFilterParam(name: string, fallback = '') {
  const [params, setParams] = useSearchParams();
  const value = params.get(name) ?? fallback;

  const set = useCallback(
    (next: string | null) => {
      setParams(
        (cur) => {
          const p = new URLSearchParams(cur);
          if (next === null || next === fallback) p.delete(name);
          else p.set(name, next);
          return p;
        },
        { replace: true },
      );
    },
    [name, fallback, setParams],
  );

  return [value, set] as const;
}
