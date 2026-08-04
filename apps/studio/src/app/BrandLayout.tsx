import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Outlet, useNavigate, useParams } from 'react-router';
import { api, type Brand, type Project } from '../api.js';
import { rememberBrand } from '../prefs.js';
import { ProjectPicker } from '../views/ProjectPicker.js';
import { SettingsDialog } from '../views/SettingsDialog.js';
import { useAppData, useDialogParam } from './AppShell.js';

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
      <Outlet />
    </Ctx.Provider>
  );
}
