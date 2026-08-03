import React from 'react';
import { createRoot } from 'react-dom/client';
import '@radix-ui/themes/styles.css';
import '@fontsource-variable/inter-tight';
import '@fontsource/playfair-display/400-italic.css';
import '@fontsource/playfair-display/500-italic.css';
import './styles/tokens.css';
import { ThemeProvider } from './theme.js';
import { ToastProvider } from './toasts.js';
import { App } from './App.js';

// set theme before first paint to avoid a flash of the wrong scheme
const saved = localStorage.getItem('bt-theme');
document.documentElement.dataset.theme =
  saved === 'light' || saved === 'dark'
    ? saved
    : window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
