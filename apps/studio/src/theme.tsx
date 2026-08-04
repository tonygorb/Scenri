import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Theme } from '@radix-ui/themes';
import { migrateKey } from './prefs.js';

/** What the user chose. 'system' follows the OS and keeps following it. */
export type ThemeChoice = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

const KEY = 'sc-theme';
/** Pre-rename spelling, moved to KEY the first time anyone loads the studio. */
const LEGACY_KEY = 'bt-theme';
const prefersLight = () => window.matchMedia('(prefers-color-scheme: light)').matches;

const ThemeCtx = createContext<{
  choice: ThemeChoice;
  mode: Resolved;
  setChoice: (c: ThemeChoice) => void;
  toggle: () => void;
}>({ choice: 'system', mode: 'dark', setChoice: () => {}, toggle: () => {} });

export const useThemeMode = () => useContext(ThemeCtx);

function initialChoice(): ThemeChoice {
  const saved = localStorage.getItem(KEY) ?? migrateKey(LEGACY_KEY, KEY);
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(initialChoice);
  const [systemMode, setSystemMode] = useState<Resolved>(() => (prefersLight() ? 'light' : 'dark'));

  // 'system' is a live subscription, not a one-time read
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setSystemMode(mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const mode: Resolved = choice === 'system' ? systemMode : choice;

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    localStorage.setItem(KEY, choice);
  }, [mode, choice]);

  const value = useMemo(
    () => ({
      choice,
      mode,
      setChoice,
      // the topbar button is a straight flip, so it commits to a side
      toggle: () => setChoice(mode === 'dark' ? 'light' : 'dark'),
    }),
    [choice, mode],
  );

  return (
    <ThemeCtx.Provider value={value}>
      <Theme appearance={mode} accentColor="gray" grayColor="gray" radius="large" scaling="100%">
        {children}
      </Theme>
    </ThemeCtx.Provider>
  );
}
