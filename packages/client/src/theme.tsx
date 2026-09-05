import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// Light / dark only - a deliberate 2-way switch, no "system" mode and no live
// OS following after the first load (per scriptorium#53). The OS preference is
// consulted exactly once, by the pre-paint script, when nothing is stored.
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'scriptorium-theme';

// The single place the DOM is mutated. `.dark` is the shadcn / Tailwind v4
// class hook; `color-scheme` flips native controls, scrollbars and form
// widgets in lockstep.
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

// Same resolution the inline pre-paint script in index.html performs. Exported
// so tests can reproduce the pre-paint step (the inline script never runs in
// jsdom) and so the logic lives in one readable place.
export function resolveInitialTheme(): Theme {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // localStorage unavailable (private mode, disabled) - treat as unset.
  }
  if (stored === 'dark') return 'dark';
  if (stored === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initial state is read back from what the pre-paint script already put on
  // the DOM, so React and the DOM never disagree and StrictMode's double
  // invoke cannot cause a re-flash.
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Storage write failed - the DOM is still updated, the choice just
        // won't survive a reload.
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

// Minimal, unstyled toggle. The styled top-bar button lands in scriptorium#61;
// this just gives the mechanism a working control in the meantime.
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
      }
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}
