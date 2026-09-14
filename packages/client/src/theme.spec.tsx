import { StrictMode, useEffect, useRef } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClerkProvider } from '@clerk/react';
import { ClerkGate } from './clerk-gate';
import {
  ThemeProvider,
  isDarkTheme,
  normaliseStoredTheme,
  resolveInitialTheme,
} from './theme';
import { ThemeToggle } from './components/shell/theme-toggle';

jest.mock('@clerk/react', () => ({
  ClerkProvider: jest.fn(
    (props: { children: unknown }) => props.children as never,
  ),
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: false,
    getToken: async () => null,
  }),
  SignIn: () => null,
  UserButton: () => null,
}));

jest.mock('./env', () => ({
  env: { clerkPublishableKey: 'pk_test_x', apiUrl: 'http://api.test' },
}));

const clerkProviderMock = ClerkProvider as unknown as jest.Mock;

const lastAppearance = () =>
  clerkProviderMock.mock.calls.at(-1)?.[0].appearance as {
    variables: Record<string, string>;
    options: { shimmer: boolean };
  };

function prePaint() {
  const theme = resolveInitialTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', isDarkTheme(theme));
  document.documentElement.style.colorScheme = isDarkTheme(theme)
    ? 'dark'
    : 'light';
}

let subtreeMounts = 0;
function MountProbe() {
  const first = useRef(true);
  useEffect(() => {
    subtreeMounts += 1;
    return () => {
      first.current = false;
    };
  }, []);
  return null;
}

function renderTree({ strict = false } = {}) {
  prePaint();
  const tree = (
    <ThemeProvider>
      <ClerkGate>
        <MountProbe />
        <ThemeToggle />
      </ClerkGate>
    </ThemeProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const isDark = () => document.documentElement.classList.contains('dark');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = '';
  clerkProviderMock.mockClear();
  subtreeMounts = 0;
});

afterEach(cleanup);

test('first visit defaults to Poimandres', () => {
  renderTree();
  expect(document.documentElement.dataset.theme).toBe('poimandres');
  expect(isDark()).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe('dark');
});

test('stored light and dark choices migrate to named schemes', () => {
  expect(normaliseStoredTheme('dark')).toBe('poimandres');
  expect(normaliseStoredTheme('light')).toBe('lattice-light');
});

test('StrictMode double-invoke does not re-flash the theme', () => {
  renderTree({ strict: true });
  expect(document.documentElement.dataset.theme).toBe('poimandres');
  expect(isDark()).toBe(true);
});

test('theme selector writes data-theme, compatibility class, colorScheme and localStorage', async () => {
  renderTree();
  expect(localStorage.getItem('scriptorium-theme')).toBeNull();

  await userEvent.click(
    screen.getByRole('button', { name: /select colour scheme/i }),
  );
  await userEvent.click(screen.getByRole('option', { name: /lattice light/i }));

  expect(document.documentElement.dataset.theme).toBe('lattice-light');
  expect(isDark()).toBe(false);
  expect(document.documentElement.style.colorScheme).toBe('light');
  expect(localStorage.getItem('scriptorium-theme')).toBe('lattice-light');

  await userEvent.click(
    screen.getByRole('button', { name: /select colour scheme/i }),
  );
  await userEvent.click(screen.getByRole('option', { name: /ros/i }));

  expect(document.documentElement.dataset.theme).toBe('rose-pine');
  expect(isDark()).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe('dark');
  expect(localStorage.getItem('scriptorium-theme')).toBe('rose-pine');
});

test('a stored named choice wins over the default', () => {
  localStorage.setItem('scriptorium-theme', 'catppuccin');
  renderTree();
  expect(document.documentElement.dataset.theme).toBe('catppuccin');
  expect(isDark()).toBe(true);
});

test('ClerkGate binds Clerk to the app CSS tokens: theme switch is a CSS recompute, not a remount', async () => {
  renderTree();

  expect(subtreeMounts).toBe(1);
  const first = lastAppearance();
  expect(first.variables.colorBackground).toBe('var(--card)');
  expect(first.variables.colorPrimary).toBe('var(--primary)');
  expect(first.variables.colorInput).toBe('var(--background)');
  expect(
    Object.values(first.variables).every((v) => v.startsWith('var(--')),
  ).toBe(true);
  expect(first.options.shimmer).toBe(true);

  await userEvent.click(
    screen.getByRole('button', { name: /select colour scheme/i }),
  );
  await userEvent.click(screen.getByRole('option', { name: /lattice light/i }));

  const next = lastAppearance();
  expect(next).toBe(first);
  expect(document.documentElement.dataset.theme).toBe('lattice-light');
  expect(isDark()).toBe(false);
  expect(subtreeMounts).toBe(1);
});
