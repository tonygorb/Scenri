import { createContext, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { titleFor } from './documentTitle.js';

type Publish = (name: string | null) => void;

/** How a detail page reaches the one writer above it. */
export const DocumentTitleCtx = createContext<Publish | null>(null);

/**
 * The only thing in the app that assigns `document.title`. Called once, in the
 * shell, and it hands back the channel the pages below use to name themselves.
 *
 * The name of the thing on screen is known a level down, and React runs child
 * effects before parent ones, so a detail page writing the title directly is
 * overwritten by the shell on the very next route change. Publishing the name
 * as state instead lets one effect run with the path, the query and the name
 * all settled.
 */
export function useDocumentTitle(): Publish {
  const { pathname, search } = useLocation();
  const [entity, setEntity] = useState<string | null>(null);

  useEffect(() => {
    document.title = titleFor(pathname, search, entity);
  }, [pathname, search, entity]);

  return setEntity;
}

/**
 * Name the tab after the thing this page is showing. Null while it loads, and
 * null again if it turns out to be gone, which leaves the section name in
 * place. Cleared on the way out, so a route change cannot strand the last name
 * the tab saw.
 */
export function useTitleEntity(name: string | null | undefined): void {
  const publish = useContext(DocumentTitleCtx);
  useEffect(() => {
    if (!publish) return;
    publish(name ?? null);
    return () => publish(null);
  }, [publish, name]);
}
