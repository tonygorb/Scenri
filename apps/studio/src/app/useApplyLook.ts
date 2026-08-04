import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api.js';
import { useBrand } from './BrandLayout.js';

/**
 * "Use this look" from the Looks index or a look page. Reuses the newest
 * project rather than littering one per try, and makes the first one when the
 * brand has none.
 */
export function useApplyLook(): (lookId: string) => Promise<void> {
  const { brand, projects, refreshProjects } = useBrand();
  const navigate = useNavigate();

  return useCallback(
    async (lookId: string) => {
      const existing = projects[0];
      const id = existing?.id ?? (await api.createProject(brand.id, 'Untitled')).project.id;
      if (!existing) await refreshProjects();
      navigate(`/b/${brand.id}/p/${id}?look=${encodeURIComponent(lookId)}`);
    },
    [brand.id, projects, refreshProjects, navigate],
  );
}
