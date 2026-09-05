import { StrictMode, useEffect, useRef } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClerkProvider } from '@clerk/react';
import { ClerkGate } from './clerk-gate';
import { ThemeProvider, ThemeToggle, resolveInitialTheme } from './theme';

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
  };

function setPrefersDark(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: dark,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Reproduce the index.html pre-paint script: it, not React, sets the initial
// class. Tests must run it because the inline script never executes in jsdom.
function prePaint() {
  const theme = resolveInitialTheme();
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

// Mounts once; increments on every (re)mount of its subtree. Used to prove
// ClerkProvider's subtree is not torn down when the theme changes.
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
  document.documentElement.style.colorScheme = '';
  clerkProviderMock.mockClear();
  subtreeMounts = 0;
});

afterEach(cleanup);

test('first visit with no stored choice follows the OS dark preference', () => {
  setPrefersDark(true);
  renderTree();
  expect(isDark()).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe('dark');
});

test('first visit with no stored choice follows the OS light preference', () => {
  setPrefersDark(false);
  renderTree();
  expect(isDark()).toBe(false);
  expect(document.documentElement.style.colorScheme).toBe('light');
});

test('StrictMode double-invoke does not re-flash the theme', () => {
  setPrefersDark(true);
  renderTree({ strict: true });
  expect(isDark()).toBe(true);
});

test('toggle flips the class, colorScheme and writes localStorage', async () => {
  setPrefersDark(false);
  renderTree();
  expect(isDark()).toBe(false);
  expect(localStorage.getItem('scriptorium-theme')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: /dark theme/i }));
  expect(isDark()).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe('dark');
  expect(localStorage.getItem('scriptorium-theme')).toBe('dark');

  await userEvent.click(screen.getByRole('button', { name: /light theme/i }));
  expect(isDark()).toBe(false);
  expect(document.documentElement.style.colorScheme).toBe('light');
  expect(localStorage.getItem('scriptorium-theme')).toBe('light');
});

test('a stored "dark" choice wins over a light OS preference', () => {
  localStorage.setItem('scriptorium-theme', 'dark');
  setPrefersDark(false);
  renderTree();
  expect(isDark()).toBe(true);
});

test('a stored "light" choice wins over a dark OS preference', () => {
  localStorage.setItem('scriptorium-theme', 'light');
  setPrefersDark(true);
  renderTree();
  expect(isDark()).toBe(false);
});

test('ClerkGate swaps the appearance on toggle without remounting ClerkProvider', async () => {
  setPrefersDark(false);
  renderTree();

  expect(subtreeMounts).toBe(1);
  const first = lastAppearance();
  expect(first.variables.colorBackground).toBe('#ffffff');

  await userEvent.click(screen.getByRole('button', { name: /dark theme/i }));

  const next = lastAppearance();
  expect(next.variables.colorBackground).toBe('#16171c');
  expect(next).not.toBe(first);
  // No teardown of ClerkProvider's subtree - Clerk.js is not re-initialised.
  expect(subtreeMounts).toBe(1);
});
