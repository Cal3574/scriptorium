# Clerk component theming (research)

Research ticket: [Cal3574/scriptorium#49](https://github.com/Cal3574/scriptorium/issues/49).
Map: #47.
Scope: theme Clerk's prebuilt components (`<SignIn>`, `<UserButton>`) from Scriptorium's own design tokens, and flip them in lockstep with a manual light/dark toggle.
Stack: `packages/client` is a React 19 + Vite SPA using `@clerk/react` `^6.14.8`.
Clerk "Core 3" (changelog dated 2026-03-03) renamed the React SDK from `@clerk/clerk-react` to `@clerk/react`, so `^6.14.8` under that name is a Core 3 install and every claim below is checked against the Core 3 docs, not older `baseTheme`/`@clerk/themes` tutorials ([https://clerk.com/changelog/2026-03-03-core-3](https://clerk.com/changelog/2026-03-03-core-3)).
All claims are cited inline against primary sources (Clerk docs, Clerk changelog, Clerk upgrade guide, `clerk/javascript` on GitHub).

## Current mount in the repo

`packages/client/src/bootstrap.tsx` renders `<ClerkProvider publishableKey={env.clerkPublishableKey} afterSignOutUrl="/">` with no `appearance` prop.
`packages/client/src/App.tsx` renders the bare `<SignIn />` for signed-out visitors and `<UserButton />` in the header for signed-in ones, again with no `appearance` prop.
There is no theme toggle or theme context in the client yet, and `index.html` / global CSS set no `color-scheme`.
So this is a greenfield theming job: add `appearance` at the provider, and add a theme source the provider can read.

## 1. The `appearance` prop: where it lives and what it accepts

The `appearance` prop "can be used to share styles across every component, or applied individually to any of the Clerk components" - set it on `<ClerkProvider>` for every component, or on a single `<SignIn>` / `<UserButton>` instance to override just that one ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview)).
It can also be scoped to *all* instances of one component by nesting it under a component key on the provider's `appearance` (e.g. `appearance={{ signIn: { ... } }}`) ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes)).

Core 3 keys of the `appearance` object ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview)):

| Key | Type | Purpose |
| --- | --- | --- |
| `theme` | `BaseTheme \| BaseTheme[]` | Foundational prebuilt theme(s). **Renamed from `baseTheme` in Core 3.** |
| `variables` | object | "General theme overrides... merged with our base theme. Can override global styles like colors, fonts, etc." |
| `elements` | object | "Fine-grained theme overrides. Useful when you want to style specific elements or elements that are under a specific state." |
| `options` | object | "Configuration options that affect the layout of the components, allowing customizations that are hard to implement with just CSS." **Renamed from `layout` in Core 3.** |
| `captcha` | object | Appearance of the CAPTCHA widget. |
| `cssLayerName` | string | "The name of the CSS layer for Clerk component styles... allowing you to control the cascade and prevent style conflicts by isolating Clerk's styles within a specific layer." |

Cascade: `theme` is the base, `variables` merge over it as global design tokens, `elements` override specific DOM nodes/states last, and component-level `appearance` merges over provider-level `appearance` ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview), [https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes)).

`options` keys (all optional) ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/options](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/options)):

| Key | Values | Default |
| --- | --- | --- |
| `animations` | boolean | `true` |
| `autoFocus` | boolean | `true` |
| `elevation` | `'raised' \| 'flush'` | `'raised'` |
| `logoPlacement` | `'inside' \| 'outside'` | `'inside'` |
| `logoImageUrl` / `logoLinkUrl` | string | - |
| `helpPageUrl` / `privacyPageUrl` / `termsPageUrl` | string | - |
| `shimmer` | boolean | `true` |
| `showOptionalFields` | boolean | `false` |
| `socialButtonsPlacement` | `'bottom' \| 'top'` | `'top'` |
| `socialButtonsVariant` | `'blockButton' \| 'iconButton' \| 'auto'` | `auto` |
| `unsafe_disableDevelopmentModeWarnings` | boolean | - |

## 2. `baseTheme` / prebuilt themes and the themes package

In Core 3 the key is `theme` (not `baseTheme`), and the prebuilt themes are imported from **`@clerk/ui/themes`**, not the old `@clerk/themes` package ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes), [https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)).
`@clerk/themes` on npm is the Core 2 package; Core 3 moved theme exports into the `@clerk/ui` package ([https://www.npmjs.com/package/@clerk/themes](https://www.npmjs.com/package/@clerk/themes), [https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)).

Six prebuilt themes ship: Default, Simple, shadcn, Dark, Shades of Purple, Neobrutalism, with export names `dark`, `simple` (also usable as the string `'simple'`), `shadcn`, `shadesOfPurple`, `neobrutalism` ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes), [https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)).

Dark theme usage ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes)):

```tsx
import { dark } from '@clerk/ui/themes'

<ClerkProvider appearance={{ theme: dark }} />
```

**Multiple base themes can be composed** by passing an array: "The themes will be applied in the order they are listed. If styles overlap, the last defined theme will take precedence." ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes)):

```tsx
import { dark, neobrutalism, shadesOfPurple } from '@clerk/ui/themes'

<ClerkProvider
  appearance={{
    theme: [dark, neobrutalism],
    variables: { colorPrimary: 'blue' },
    signIn: {
      theme: [shadesOfPurple],
      variables: { colorPrimary: 'green' },
    },
  }}
/>
```

There is also an experimental theme factory: Core 3 moved `__experimental_createTheme` from `@clerk/ui` to `import { createTheme } from '@clerk/ui/themes/experimental'` ([https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)).
Clerk also ships a visual **theme editor** (Core 3) that lets you adjust colors, spacing, typography and borders with a live preview and copy the resulting config ([https://clerk.com/changelog/2026-03-03-core-3](https://clerk.com/changelog/2026-03-03-core-3)).

Note: for Scriptorium's "our own design tokens" goal, you often don't need a prebuilt `theme` at all - the Default theme plus `variables` bound to your CSS custom properties is enough. Add `theme: dark` only if you want Clerk's hand-tuned dark palette as the starting point rather than deriving dark from your own tokens.

## 3. `appearance.variables` - the design-token surface

Full Core 3 list ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables)):

Colors: `colorPrimary`, `colorPrimaryForeground`, `colorForeground` (main text - **was `colorText`** pre-Core-3), `colorMutedForeground` (secondary text), `colorMuted` (muted background), `colorBackground` (card background), `colorNeutral` (base for borders/hovers), `colorBorder`, `colorRing` (focus ring), `colorShadow`, `colorInput` (input background - **was `colorInputBackground`**), `colorInputForeground` (input text - **was `colorInputText`**), `colorDanger`, `colorSuccess`, `colorWarning`, `colorShimmer` (avatar shimmer), `colorModalBackdrop`.

Typography: `fontFamily` (default `inherit`), `fontFamilyButtons` (default `inherit`), `fontFamilyMono`, `fontSize` (string, or object with `xs`/`sm`/`md`/`lg`/`xl`; default `0.8125rem`), `fontWeight` (object; default `{ normal: 400, medium: 500, semibold: 600, bold: 700 }`).

Spacing/shape: `borderRadius` (default `0.375rem`), `spacing` (base unit, default `1rem`).

**CSS custom properties are supported as values** - the docs give this exact example ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables)):

```tsx
<ClerkProvider appearance={{ variables: { colorPrimary: 'var(--brand-primary)' } }}>
```

```css
:root { --brand-primary: oklch(49.1% 0.27 292.581); }
@media (prefers-color-scheme: dark) {
  :root { --brand-primary: oklch(54.1% 0.281 293.009); }
}
```

Caveat, quoted verbatim: "For broader browser support, when using the `variables` prop, use direct color values (e.g., `colorPrimary: '#6c47ff'`) instead of CSS variables or modern color functions." ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables)).
The reason: Clerk derives shades from your base colors using `color-mix()` and relative color syntax, which need Chrome 111+/Firefox 113+/Safari 16.2+ (`color-mix()`) and Chrome 119+/Firefox 120+/Safari 16.4+ (relative color) ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables)).
For a React 19 SPA targeting modern evergreen browsers this is fine; just be aware that a `var(--x)` whose value is itself an `oklch()`/`color-mix()` expression compounds the support requirement.

Core 3 opacity change: `colorRing` and `colorModalBackdrop` now render at full opacity (previously 15%). If you want a translucent ring/backdrop you must pass an `rgba()` / alpha value yourself ([https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)).

## 4. Runtime theme switching with a manual toggle

Two mechanisms, and the robust answer is to use both together.

### 4a. CSS-variable-only (no re-render)

If every `variables` value is a `var(--token)` and those tokens are redefined under your dark selector (`[data-theme="dark"]`, a class, or `@media (prefers-color-scheme: dark)`), then flipping that selector re-themes the mounted Clerk components with **no React re-render and no Clerk re-init** - the browser just recomputes the custom properties.
This is exactly the pattern the variables doc demonstrates with `@media (prefers-color-scheme: dark)` ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables)).
Limitation: it only moves whatever is expressed as a `variables` token. It cannot swap a prebuilt `theme` object (e.g. switch `theme: dark` on/off) or change `elements` maps, and Clerk's default component chrome that isn't bound to a variable won't move.

### 4b. Passing a new `appearance` object (the documented dark-toggle pattern)

Clerk's own themes docs switch dark mode by conditionally choosing the `theme` value from a theme hook and passing it to `<ClerkProvider appearance={...}>` - i.e. the `appearance` prop **is reactive**: when the object identity/contents change, `ClerkProvider` re-applies styles to the already-mounted components ([https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/themes](https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/themes), [https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes)).
In a plain Vite SPA (no `next-themes`), the equivalent is a small React context/state holding `'light' | 'dark'`, with `ClerkProvider` fed a `useMemo`'d `appearance` derived from it:

```tsx
const appearance = useMemo(
  () => ({ theme: mode === 'dark' ? dark : undefined, variables: sharedVariables }),
  [mode],
);
return <ClerkProvider appearance={appearance} ...>{children}</ClerkProvider>;
```

Clerk re-renders the open components when this changes; there can be a brief restyle flicker on toggle but it does not unmount `<SignIn>` or drop form state in practice. Do **not** remount `ClerkProvider` itself (e.g. via a `key` prop) to force the change - that re-initialises Clerk.js and flashes the whole auth UI.

### 4c. `unstable_*` / experimental APIs

There is no `unstable_setAppearance` runtime API. The only experimental appearance surface is the theme factory (`createTheme` from `@clerk/ui/themes/experimental`) and the `__experimental_` prefix standardization in Core 3 - neither is a runtime switch mechanism ([https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)).

### 4d. Recommendation

Drive Clerk from CSS custom properties for everything expressible as a `variables` token (4a) so the bulk of the switch is a zero-cost CSS recompute, and *also* pass a memoized `appearance` from your theme state (4b) so the pieces that need a real theme object (or `elements` that differ by mode) move in lockstep. Keep the toggle writing a `data-theme` attribute on `<html>` that both your app CSS and the `var(--token)` definitions key off.

## 5. `elements` overrides - internal class names and their caveats

To find a target: inspect the rendered Clerk DOM. A node's class list looks like `cl-formButtonPrimary cl-button 🔒️ cl-internal-1ta0xpz`. Classes **before** the lock icon are stable public descriptors; classes **after** it ("`cl-internal-*`") "are internal classes used for Clerk's internal styling" and change without notice - never target them ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css)).

Three ways to use the stable descriptors ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css)):
1. Target the `cl-` class directly in a stylesheet: `.cl-formButtonPrimary { background-color: #611bbd }`.
2. Drop the `cl-` prefix and use it as an `appearance.elements` key, with a value that is a className string (custom class, Tailwind utilities, CSS module) or an inline style object.
3. State variants: `elements` keys can carry a state suffix (e.g. an error/open/active state) for "elements that are under a specific state" ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview)).

Stability: the public `cl-*` descriptor names are the documented contract and are stable; the `cl-internal-*` hashes are not. Even so, treat `elements` as the brittle layer - prefer `variables` for anything a token can express, and reach for `elements` only for structural tweaks (hiding a element, changing a layout property) that `variables` cannot reach.

CSS-layer / specificity caveat: Clerk injects its own styles, and with Tailwind CSS v4 (which is layer-based) you should set `cssLayerName` on `<ClerkProvider>` so Clerk's styles sit in a named `@layer` and your utilities can reliably win the cascade; without it you get specificity conflicts and unpredictable ordering ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css), [https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview)).
Scriptorium's client is plain CSS today, not Tailwind, so `cssLayerName` is optional now but is the right knob if a Clerk style ever out-specifies one of ours.

## 6. Flash-of-wrong-theme with Clerk

Relevant facts:
- Clerk's default theme "supports both light and dark modes, with light mode displaying by default unless a `color-scheme` is defined"; set `color-scheme: light dark` in global CSS to respect system preference ([https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/themes](https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/themes)).
- Core 3 makes components "automatically match your app's color scheme if it supports light and dark mode" ([https://clerk.com/changelog/2026-03-03-core-3](https://clerk.com/changelog/2026-03-03-core-3)).
- The bring-your-own-CSS guide explicitly warns "Flash-of-unstyled-content can occur without proper theme application" ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css)).

Where the flash comes from in this SPA:
1. Clerk components mount asynchronously after Clerk.js loads, so there is always a beat where the surrounding app is themed and the Clerk widget is not yet rendered - unavoidable, but it is blank space, not a wrong-colour widget, and Clerk's `shimmer` placeholder fills it.
2. If the dark/light choice is read from `localStorage` in React state, the first client render is with the default (light) value, then a re-render flips it - the classic FOWT. Fix it the standard way: an inline `<script>` in `index.html` that reads the stored preference and sets `data-theme` / `color-scheme` on `<html>` *before* first paint, so both your CSS variables and Clerk's `color-scheme` detection are correct on the first frame. This is a Vite/`index.html` concern, not something Clerk provides.
3. If you toggle by swapping the `appearance` object, expect a short restyle on the already-mounted widget. Binding `variables` to `var(--token)`s (section 4a) minimises this because the changing surface is a CSS recompute, not a Clerk re-style.

Clerk offers no SSR/pre-render hook for a Vite SPA, so there is no Clerk-side way to eliminate the initial mount gap; the `shimmer` option and getting `data-theme` right pre-paint are the mitigations.

## Recommended appearance config

Model: one set of design tokens as CSS custom properties, redefined under `[data-theme="dark"]`; Clerk `variables` point at those tokens; a memoized `appearance` also swaps Clerk's `dark` base theme so non-token chrome follows.

`packages/client/src/index.css` (or global stylesheet):

```css
:root {
  color-scheme: light;
  --color-bg: #ffffff;
  --color-fg: #1a1a1a;
  --color-fg-muted: #6b7280;
  --color-muted: #f3f4f6;
  --color-border: #e5e7eb;
  --color-primary: #4f46e5;
  --color-primary-fg: #ffffff;
  --color-input: #ffffff;
  --color-input-fg: #1a1a1a;
  --color-danger: #dc2626;
  --color-success: #16a34a;
  --color-warning: #d97706;
  --radius: 0.5rem;
  --font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

[data-theme='dark'] {
  color-scheme: dark;
  --color-bg: #0b0b0f;
  --color-fg: #f4f4f5;
  --color-fg-muted: #9ca3af;
  --color-muted: #18181b;
  --color-border: #27272a;
  --color-primary: #818cf8;
  --color-primary-fg: #0b0b0f;
  --color-input: #111114;
  --color-input-fg: #f4f4f5;
}
```

`index.html` - pre-paint theme set (kills FOWT):

```html
<script>
  (function () {
    try {
      var t = localStorage.getItem('scriptorium-theme');
      if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = t;
    } catch (e) {}
  })();
</script>
```

`packages/client/src/theme.tsx` - toggle state (writes the attribute the CSS and Clerk both read):

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Mode = 'light' | 'dark';
const ThemeCtx = createContext<{ mode: Mode; toggle: () => void }>({ mode: 'light', toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(
    () => (document.documentElement.dataset.theme as Mode) || 'light',
  );
  const toggle = useCallback(() => {
    setMode((m) => {
      const next = m === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('scriptorium-theme', next); } catch (e) {}
      return next;
    });
  }, []);
  return <ThemeCtx.Provider value={useMemo(() => ({ mode, toggle }), [mode, toggle])}>{children}</ThemeCtx.Provider>;
}
```

`packages/client/src/bootstrap.tsx` - Clerk wired to the tokens and the mode:

```tsx
import { ClerkProvider } from '@clerk/react';
import { dark } from '@clerk/ui/themes';
import { useMemo } from 'react';
import { ThemeProvider, useTheme } from './theme';

const clerkVariables = {
  colorPrimary: 'var(--color-primary)',
  colorPrimaryForeground: 'var(--color-primary-fg)',
  colorBackground: 'var(--color-bg)',
  colorForeground: 'var(--color-fg)',
  colorMutedForeground: 'var(--color-fg-muted)',
  colorMuted: 'var(--color-muted)',
  colorBorder: 'var(--color-border)',
  colorInput: 'var(--color-input)',
  colorInputForeground: 'var(--color-input-fg)',
  colorDanger: 'var(--color-danger)',
  colorSuccess: 'var(--color-success)',
  colorWarning: 'var(--color-warning)',
  borderRadius: 'var(--radius)',
  fontFamily: 'var(--font-sans)',
};

function ClerkWithTheme({ children }: { children: React.ReactNode }) {
  const { mode } = useTheme();
  const appearance = useMemo(
    () => ({
      theme: mode === 'dark' ? dark : undefined,
      variables: clerkVariables,
      options: { socialButtonsVariant: 'blockButton' as const },
    }),
    [mode],
  );
  return (
    <ClerkProvider publishableKey={env.clerkPublishableKey} afterSignOutUrl="/" appearance={appearance}>
      {children}
    </ClerkProvider>
  );
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <ClerkWithTheme>
        <App />
      </ClerkWithTheme>
    </ThemeProvider>
  </StrictMode>,
);
```

If you would rather not depend on `@clerk/ui/themes` at all, drop `theme` entirely and rely solely on `variables` bound to `var(--token)`s plus dark values under `[data-theme="dark"]` - the toggle then costs zero React work for Clerk. Add `theme: dark` only if the default-theme dark rendering (derived from your tokens) doesn't look right.

Add `elements` entries only when you hit something `variables` can't reach, e.g.:

```tsx
elements: {
  card: 'shadow-none border',           // className string
  footer: { display: 'none' },          // inline style object
}
```

## Gotchas

- **Package/key names moved in Core 3.** It is `appearance.theme` not `appearance.baseTheme`; `appearance.options` not `appearance.layout`; themes come from `@clerk/ui/themes` not `@clerk/themes` (that npm package is Core 2). Most Clerk theming blog posts and Stack Overflow answers predate this ([https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3), [https://www.npmjs.com/package/@clerk/themes](https://www.npmjs.com/package/@clerk/themes)).
- **Variable renames:** `colorText` -> `colorForeground`, `colorInputBackground` -> `colorInput`, `colorInputText` -> `colorInputForeground`. Old names are silently ignored ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables), [https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)).
- **`colorRing` / `colorModalBackdrop` now full opacity in Core 3.** Pass an explicit `rgba()` if you want them translucent ([https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)).
- **`var(--foo)` values work but are the lower-compatibility path.** Clerk's shade derivation uses `color-mix()` + relative color syntax; nesting `oklch()`/`color-mix()` inside your custom properties raises the minimum browser bar. Plain hex/rgb in the token definitions is safest ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables)).
- **Don't remount `ClerkProvider` to switch themes.** Changing a `key` or unmount/remount re-initialises Clerk.js and flashes the whole auth widget. Pass a new `appearance` object instead - the prop is reactive ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes)).
- **FOWT is on us, not Clerk.** There is no SSR hook for a Vite SPA. Set `data-theme` / `color-scheme` on `<html>` from an inline `index.html` script before first paint, or the first React render is light and then flips ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css)).
- **Initial mount gap is unavoidable.** Clerk components render only after Clerk.js loads; keep `options.shimmer` on (default) so the gap is a skeleton, not a jump.
- **`elements` targets: only classes before the 🔒️.** `cl-internal-*` hashes change without notice. Prefer `variables`; keep `elements` minimal ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css)).
- **Tailwind v4 later:** if the client adopts Tailwind v4, set `cssLayerName` on `<ClerkProvider>` so Clerk's styles are in a named `@layer` and don't out-specify utilities ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css)).
- **Theme arrays are last-wins.** `theme: [dark, neobrutalism]` applies `dark` then `neobrutalism`; overlapping styles resolve to the last entry, then `variables`, then `elements` ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes)).
- **Component-scoped `appearance` for nested components** (e.g. the `<UserProfile>` opened by `<UserButton>`) must be passed through the dedicated props object (`userProfileProps={{ appearance: {...} }}`), not the top-level `appearance` ([https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview)).

## Sources

- [https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview)
- [https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables)
- [https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/themes)
- [https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/options](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/options)
- [https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/bring-your-own-css)
- [https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/themes](https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/themes)
- [https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)
- [https://clerk.com/changelog/2026-03-03-core-3](https://clerk.com/changelog/2026-03-03-core-3)
- [https://www.npmjs.com/package/@clerk/themes](https://www.npmjs.com/package/@clerk/themes)
