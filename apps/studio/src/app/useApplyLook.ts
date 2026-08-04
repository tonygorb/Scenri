import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api.js';
import { useBrand } from './BrandLayout.js';
import { brandPath } from './brandPath.js';

/**
 * "Use this look" from the Looks index or a look page. Reuses the newest
 * project rather than littering one per try, and makes the first one when the
 * brand has none.
 */
export function useApplyLook(): (lookId: string) => Promise<void> {
  const { brand, projects, refreshProjects } = useBrand();
  const navigate = useNavigate();
  // a string, so the callback survives a brand refetch handing back a new object
  const base = brandPath(brand);

  return useCallback(
    async (lookId: string) => {
      const existing = projects[0];
      const slug = existing?.slug ?? (await api.createProject(brand.id, 'Untitled')).project.slug;
      if (!existing) await refreshProjects();
      navigate(`${base}/p/${slug}?look=${encodeURIComponent(lookId)}`);
    },
    [brand.id, base, projects, refreshProjects, navigate],
  );
}
