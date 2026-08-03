import { useCallback, useEffect, useMemo, useState } from 'react';
import { Callout, Flex, Spinner } from '@radix-ui/themes';
import { House, PlusCircle, Stack, UsersThree } from '@phosphor-icons/react';
import { api, type Brand, type EngineInfo, type Project } from './api.js';
import { HomeView } from './views/Home.js';
import { ProjectView } from './views/Project.js';
import { BrandView } from './views/Brand.js';
import { BrandSetup } from './views/BrandSetup.js';
import { LooksView } from './views/Looks.js';
import { ProjectPicker } from './views/ProjectPicker.js';
import { SettingsButton, SettingsDialog } from './views/SettingsDialog.js';
import type { NavItem } from './layout/TopBar.js';
import { LookPage } from './views/LookPage.js';

type Route =
  | { t: 'home' }
  | { t: 'project'; id: string; startTemplate?: string; openTemplates?: boolean }
  | { t: 'brand' }
  | { t: 'looks' }
  | { t: 'look'; id: string }
  | { t: 'setup' };

export function App() {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>({ t: 'home' });
  const [projects, setProjects] = useState<Project[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [b, e] = await Promise.all([api.brands(), api.engines()]);
      setBrands(b);
      setEngines(e);
      setSelected((cur) => cur ?? b[0]?.id ?? null);
    } catch (err: any) {
      setError(String(err.message ?? err));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const brand = useMemo(() => brands?.find((b) => b.id === selected) ?? null, [brands, selected]);

  useEffect(() => {
    if (!brand) return;
    void api.projects(brand.id).then(setProjects);
  }, [brand?.id, brand?.updatedAt, route.t]);

  const selectBrand = (id: string) => {
    setSelected(id);
    setRoute({ t: 'home' });
  };

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
  const setupDone = (id: string) => {
    void refresh().then(() => {
      setSelected(id);
      setRoute({ t: 'home' });
    });
  };

  // first run, or an explicit setup route: the wizard IS the screen
  if (!brand || route.t === 'setup') {
    return (
      <BrandSetup
        onDone={setupDone}
        onCancel={() => {
          void refresh();
          setRoute({ t: 'home' });
        }}
        canCancel={!!brand}
      />
    );
  }

  const goSetup = () => setRoute({ t: 'setup' });
  /** Open a project for a look: reuse the newest one, or make a fresh one. */
  const applyLook = async (lookId: string) => {
    const existing = projects[0];
    if (existing) return setRoute({ t: 'project', id: existing.id, startTemplate: lookId });
    if (!brand) return;
    const made = await api.createProject(brand.id, 'Untitled');
    await refresh();
    setRoute({ t: 'project', id: made.project.id, startTemplate: lookId });
  };
  const navFor = (here: 'home' | 'create' | 'looks' | 'brand'): NavItem[] => [
    { label: 'Home', icon: <House size={13} />, active: here === 'home', onClick: () => setRoute({ t: 'home' }) },
    {
      label: 'Create',
      icon: <PlusCircle size={13} />,
      active: here === 'create',
      // with nothing open, ask which project rather than guessing the newest
      onClick: () => {
        if (here !== 'create') setPickerOpen(true);
      },
    },
    { label: 'Looks', icon: <Stack size={13} />, active: here === 'looks', onClick: () => setRoute({ t: 'looks' }) },
    {
      label: 'Brand',
      icon: <UsersThree size={13} />,
      active: here === 'brand',
      onClick: () => setRoute({ t: 'brand' }),
    },
  ];
  const newProject = async () => {
    if (!brand) return;
    const made = await api.createProject(brand.id, 'Untitled');
    await refresh();
    setRoute({ t: 'project', id: made.project.id });
  };
  const settingsButton = <SettingsButton />;

  return (
    <>
      <SettingsDialog engines={engines} projects={projects} onSaved={refresh} />
      <ProjectPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        brandId={brand.id}
        onPick={(id) => setRoute({ t: 'project', id })}
        onCreate={() => {
          void newProject();
        }}
      />
      {route.t === 'home' && (
        <HomeView
          brand={brand}
          brands={brands}
          engines={engines}
          nav={navFor('home')}
          onLooks={() => setRoute({ t: 'looks' })}
          onSelectBrand={selectBrand}
          onOpenProject={(id, opts) =>
            setRoute({ t: 'project', id, startTemplate: opts?.startTemplate, openTemplates: opts?.openTemplates })
          }
          onSetup={goSetup}
          settingsButton={settingsButton}
          onBrandChanged={refresh}
        />
      )}
      {route.t === 'project' && (
        <ProjectView
          key={route.id}
          brand={brand}
          engines={engines}
          nav={navFor('create')}
          projectId={route.id}
          startTemplate={route.startTemplate}
          openTemplates={route.openTemplates}
          projects={projects}
          settingsButton={settingsButton}
          onSwitchProject={(id) => setRoute({ t: 'project', id })}
        />
      )}
      {route.t === 'looks' && (
        <LooksView
          engines={engines}
          nav={navFor('looks')}
          settingsButton={settingsButton}
          onOpenLook={(id) => setRoute({ t: 'look', id })}
          onUseLook={(id) => {
            void applyLook(id);
          }}
        />
      )}
      {route.t === 'look' && (
        <LookPage
          key={route.id}
          lookId={route.id}
          brandId={brand?.id ?? null}
          engines={engines}
          nav={navFor('looks')}
          settingsButton={settingsButton}
          onOpenLook={(id) => setRoute({ t: 'look', id })}
          onUseLook={(id) => {
            void applyLook(id);
          }}
          onBack={() => setRoute({ t: 'looks' })}
        />
      )}
      {route.t === 'brand' && (
        <BrandView
          brand={brand}
          brands={brands}
          engines={engines}
          nav={navFor('brand')}
          onSelectBrand={selectBrand}
          onSetup={goSetup}
          onDeleted={() => {
            setSelected(null);
            void refresh();
            setRoute({ t: 'home' });
          }}
          onBrandChanged={refresh}
          settingsButton={settingsButton}
        />
      )}
    </>
  );
}
