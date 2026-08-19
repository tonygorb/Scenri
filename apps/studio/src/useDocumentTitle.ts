import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { titleFor } from './documentTitle.js';

/** Keeps the browser tab naming the surface on screen. Called once, in the shell. */
export function useDocumentTitle(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleFor(pathname);
  }, [pathname]);
}
