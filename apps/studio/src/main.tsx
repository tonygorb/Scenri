import React from 'react';
import { createRoot } from 'react-dom/client';
import '@radix-ui/themes/styles.css';
import '@fontsource-variable/inter-tight';
import '@fontsource/playfair-display/400-italic.css';
import '@fontsource/playfair-display/500-italic.css';
import './styles/tokens.css';
import './styles/app.css';
import { RouterProvider } from 'react-router';
import { IconContext } from '@phosphor-icons/react';
import { ThemeProvider } from './theme.js';
import { ToastProvider } from './toasts.js';
import { router } from './router.js';
import { installInputModality } from './inputModality.js';

// Set theme before first paint to avoid a flash of the wrong scheme. Reads
// only: bt-theme is the pre-rename key, and ThemeProvider owns moving it.
const saved = localStorage.getItem('sc-theme') ?? localStorage.getItem('bt-theme');
document.documentElement.dataset.theme =
  saved === 'light' || saved === 'dark'
    ? saved
    : window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';

// Before anything renders, so the first click already reads as a click.
installInputModality();

// Every Phosphor glyph here is decoration: a control that is only an icon
// names itself with its own aria-label, and an unhidden svg is an unnamed
// image to a screen reader. The rest is Phosphor's own default, which a
// provider replaces rather than merges.
const ICONS = { color: 'currentColor', size: '1em', weight: 'regular', mirrored: false, 'aria-hidden': true } as const;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <IconContext.Provider value={ICONS}>
      <ThemeProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </ThemeProvider>
    </IconContext.Provider>
  </React.StrictMode>,
);
