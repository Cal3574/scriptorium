import { ClerkProvider } from '@clerk/react';
import { useMemo, type ReactNode } from 'react';
import { env } from './env';
import { useTheme } from './theme';

// Clerk derives its shades from these base colours with color-mix(), so it is
// handed resolved hex (not var(--token)) per the Clerk research (#49). Values
// are the design tokens from scriptorium#52 - not re-picked here.
const CLERK_FONTS = {
  fontFamily: 'var(--font-sans)',
  fontFamilyButtons: 'var(--font-sans)',
  fontFamilyMono: 'var(--font-mono)',
  borderRadius: '0.375rem',
} as const;

export const CLERK_VARIABLES = {
  light: {
    ...CLERK_FONTS,
    colorBackground: '#ffffff',
    colorForeground: '#1a1c22',
    colorPrimary: '#3d5a80',
    colorPrimaryForeground: '#ffffff',
    colorMuted: '#eef0f2',
    colorMutedForeground: '#6a6d78',
    colorBorder: '#e4e5e9',
    colorInput: '#f8f8f9',
    colorInputForeground: '#1a1c22',
    colorRing: '#3d5a80',
    colorDanger: '#b0413a',
    colorSuccess: '#15803d',
    colorWarning: '#9a6a1c',
  },
  dark: {
    ...CLERK_FONTS,
    colorBackground: '#16171c',
    colorForeground: '#e5e7ec',
    colorPrimary: '#7d9dc4',
    colorPrimaryForeground: '#0e0f13',
    colorMuted: '#1e2027',
    colorMutedForeground: '#878b98',
    colorBorder: '#24262e',
    colorInput: '#0e0f13',
    colorInputForeground: '#e5e7ec',
    colorRing: '#7d9dc4',
    colorDanger: '#d9736b',
    colorSuccess: '#5fb07d',
    colorWarning: '#cf9a45',
  },
} as const;

// ClerkGate feeds ClerkProvider a memoised `appearance` derived from the theme.
// The `appearance` prop is reactive - a new object identity re-applies styles
// to the already-mounted Clerk components. ClerkProvider is never given a
// `key` and never remounts, so Clerk.js is not re-initialised.
export function ClerkGate({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const appearance = useMemo(
    () => ({ variables: CLERK_VARIABLES[theme] }),
    [theme],
  );
  return (
    <ClerkProvider
      publishableKey={env.clerkPublishableKey}
      afterSignOutUrl="/"
      appearance={appearance}
    >
      {children}
    </ClerkProvider>
  );
}
