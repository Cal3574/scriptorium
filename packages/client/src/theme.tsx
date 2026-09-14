import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme =
  | 'poimandres'
  | 'lattice-light'
  | 'catppuccin'
  | 'gruvbox-dark'
  | 'rose-pine'
  | 'high-contrast';

export interface ThemeOption {
  id: Theme;
  label: string;
  tone: 'dark' | 'light';
  swatches: readonly [string, string, string, string];
}

export const THEME_STORAGE_KEY = 'scriptorium-theme';
export const DEFAULT_THEME: Theme = 'poimandres';

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: 'poimandres',
    label: 'Poimandres',
    tone: 'dark',
    swatches: ['#11121a', '#1b1e2b', '#89ddff', '#c792ea'],
  },
  {
    id: 'lattice-light',
    label: 'Lattice Light',
    tone: 'light',
    swatches: ['#f6f4ee', '#ffffff', '#3d6f8e', '#d98a47'],
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    tone: 'dark',
    swatches: ['#1e1e2e', '#313244', '#89b4fa', '#f5c2e7'],
  },
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox Dark',
    tone: 'dark',
    swatches: ['#1d2021', '#282828', '#fabd2f', '#8ec07c'],
  },
  {
    id: 'rose-pine',
    label: 'Rosé Pine',
    tone: 'dark',
    swatches: ['#191724', '#26233a', '#ebbcba', '#c4a7e7'],
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    tone: 'dark',
    swatches: ['#000000', '#111111', '#ffff00', '#00e5ff'],
  },
] as const;

const THEME_IDS = new Set<Theme>(THEME_OPTIONS.map((theme) => theme.id));
const DARK_THEMES = new Set<Theme>(
  THEME_OPTIONS.filter((theme) => theme.tone === 'dark').map(
    (theme) => theme.id,
  ),
);

export function isDarkTheme(theme: Theme): boolean {
  return DARK_THEMES.has(theme);
}

export function normaliseStoredTheme(stored: string | null): Theme | null {
  if (stored === 'dark') return 'poimandres';
  if (stored === 'light') return 'lattice-light';
  return THEME_IDS.has(stored as Theme) ? (stored as Theme) : null;
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle('dark', isDarkTheme(theme));
  root.style.colorScheme = isDarkTheme(theme) ? 'dark' : 'light';
}

export function resolveInitialTheme(): Theme {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // localStorage unavailable (private mode, disabled) - treat as unset.
  }
  return normaliseStoredTheme(stored) ?? DEFAULT_THEME;
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const attr = document.documentElement.dataset.theme;
    const initial = normaliseStoredTheme(attr ?? null) ?? resolveInitialTheme();
    if (attr !== initial) applyTheme(initial);
    return initial;
  });

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage write failed - the DOM is still updated, the choice just
      // won't survive a reload.
    }
    setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
