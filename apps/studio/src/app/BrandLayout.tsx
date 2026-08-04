import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useNavigate, useParams } from 'react-router';
import { api, type Brand, type Project } from '../api.js';
import { PREF, rememberBrand, useLocalPref } from '../prefs.js';
import { TabBar } from '../layout/TabBar.js';
import { TopBar } from '../layout/TopBar.js';
import { useKeyboardInset } from '../useKeyboardInset.js';
import { ProjectPicker } from '../views/ProjectPicker.js';
import { SettingsDialog } from '../views/SettingsDialog.js';
import { useAppData, useDialogParam } from './AppShell.js';
import { TaskCenterProvider } from './TaskCenter.js';

interface BrandData {
  brand: Brand;
  projects: Project[];
  refreshProjects: () => Promise<void>;
}

const Ctx = createContext<BrandData | null>(null);

export function useBrand(): BrandData {
  const value = useContext(Ctx);
  if (!value) throw new Error('useBrand must be used inside BrandLayout');
  return value;
}

interface AssetsPanelState {
  open: boolean;
  toggle: () => void;
  setOpen: (v: boolean) => void;
}

const AssetsCtx = createContext<AssetsPanelState | null>(null);

/**
 * The panel is a preference, not a location, but the button that opens it lives
 * in the bar and the panel itself lives in the project screen. One owner above
 * both: useLocalPref is plain useState behind localStorage, so two callers would
 * quietly hold two different answers.
 */
export function useAssetsPanel(): AssetsPanelState {
  const value = useContext(AssetsCtx);
  if (!value) throw new Error('useAssetsPanel must be used inside BrandLayout');
  return value;
}

/**
 * Everything under /b/:brandId. The brand lives in the path rather than in
 * state, so a refresh cannot quietly hand you a different client's work.
 */
export function BrandLayout() {
  const { brandId } = useParams();
  const { brands, engines, refresh } = useAppData();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const picker = useDialogParam('picker');
  // narrow screens get the panel as a drawer over the canvas: opening one by
  // default is a first run that starts behind a scrim
  const [assetsOpen, setAssetsOpen] = useLocalPref(PREF.assetsOpen, window.innerWidth >= 1280);
  // the '.' shortcut reads this through a listener that never re-binds, so the
  // toggle has to be an updater rather than a closure over the current value
  const toggleAssets = useCallback(() => setAssetsOpen((v) => !v), []);
  const assets = useMemo(
    () => ({ open: assetsOpen, toggle: toggleAssets, setOpen: setAssetsOpen }),
    [assetsOpen, toggleAssets],
  );

  // the docks are fixed, so the keyboard has to be measured for them
  useKeyboardInset();

  const brand = brands.find((b) => b.id === brandId) ?? null;

  const refreshProjects = useCallback(async () => {
    if (!brand) return;
    setProjects(await api.projects(brand.id));
  }, [brand?.id]);

  useEffect(() => {
    if (brand) rememberBrand(brand.id);
  }, [brand?.id]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects, brand?.updatedAt]);

  // a deleted brand, or a link to one this machine has never seen
  if (!brand) return <Navigate to="/" replace />;

  const newProject = async () => {
    const made = await api.createProject(brand.id, 'Untitled');
    await refreshProjects();
    navigate(`/b/${brand.id}/p/${made.project.id}`);
  };

  return (
    <Ctx.Provider value={{ brand, projects, refreshProjects }}>
      <SettingsDialog engines={engines} projects={projects} onSaved={refresh} />
      <ProjectPicker
        open={picker.value === '1'}
        onClose={picker.close}
        brandId={brand.id}
        onPick={(id) => navigate(`/b/${brand.id}/p/${id}`)}
        onCreate={() => {
          void newProject();
        }}
      />
      <TaskCenterProvider brandId={brand.id}>
        <AssetsCtx.Provider value={assets}>
          <div className="bt-shell">
            <TopBar />
            <Outlet />
            <TabBar />
          </div>
        </AssetsCtx.Provider>
      </TaskCenterProvider>
    </Ctx.Provider>
  );
}
