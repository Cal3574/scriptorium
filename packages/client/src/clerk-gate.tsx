import { ClerkProvider } from '@clerk/react';
import type { ReactNode } from 'react';
import { env } from './env';

// Clerk's prebuilt components (`<SignIn>`, `<UserButton>`) are themed straight
// from the app's design tokens (scriptorium#52), bound as `var(--token)`
// references rather than resolved hex. Per the Clerk Core 3 theming research
// (#49):
//
// - Default theme + `variables` on `var(--token)` - no prebuilt base theme,
//   dark is derived from our own tokens, not Clerk's `dark` theme.
// - Because every value is a live custom property, a light/dark toggle is a
//   pure CSS recompute on the already-mounted widget: the `appearance` object
//   never changes identity, Clerk does no re-style work, and `<ClerkProvider>`
//   is never remounted (which would re-init Clerk.js and flash the auth UI).
// - `options.shimmer` is left on so the unavoidable gap before Clerk.js
//   mounts is a skeleton, not a jump. The pre-paint script in `index.html`
//   sets `color-scheme` before first paint, so there is no flash of the wrong
//   theme on a cold load of the signed-out screen.
//
// Token choices: `--card` is Clerk's panel fill (not `--background`, the page
// ground); `--background` is Clerk's input fill, matching the pre-restyle
// values exactly. Core 3 variable names (`colorForeground`, `colorInput`,
// `colorInputForeground`). All of these tokens are redefined under `.dark` in
// `index.css`, so both themes stay in lockstep.
const CLERK_FONTS = {
  fontFamily: 'var(--font-sans)',
  fontFamilyButtons: 'var(--font-sans)',
  fontFamilyMono: 'var(--font-mono)',
  borderRadius: 'var(--radius)',
} as const;

export const CLERK_APPEARANCE = {
  variables: {
    ...CLERK_FONTS,
    colorBackground: 'var(--card)',
    colorForeground: 'var(--foreground)',
    colorPrimary: 'var(--primary)',
    colorPrimaryForeground: 'var(--primary-foreground)',
    colorMuted: 'var(--muted)',
    colorMutedForeground: 'var(--muted-foreground)',
    colorBorder: 'var(--border)',
    colorInput: 'var(--background)',
    colorInputForeground: 'var(--foreground)',
    colorRing: 'var(--ring)',
    colorDanger: 'var(--destructive)',
    colorSuccess: 'var(--status-ready)',
    colorWarning: 'var(--status-progress)',
  },
  options: { shimmer: true },
} as const;

// ClerkGate feeds ClerkProvider the token-bound `appearance`. The object is a
// module constant with a stable identity: nothing here reads the theme,
// because the theme switch happens entirely in CSS. ClerkProvider is never
// given a `key` and never remounts.
export function ClerkGate({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={env.clerkPublishableKey}
      afterSignOutUrl="/"
      appearance={CLERK_APPEARANCE}
    >
      {children}
    </ClerkProvider>
  );
}
