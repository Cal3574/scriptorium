# Tailwind + shadcn/ui on the `packages/client` stack (Cal3574/scriptorium#48)

Wayfinder research ticket, part of map #47.
All claims below are cited to primary sources: the official Tailwind CSS docs, the official shadcn/ui docs and changelog, the Radix UI and Module Federation repos/docs, and the actual files in `packages/client`.
Research performed 2026-09-05.

## 0. Current state of `packages/client` (repo facts)

- Vite `^8.0.13`, `@vitejs/plugin-react` `^6.0.2`, React / react-dom `^19.0.0`, TypeScript `~6.0.3`. [`packages/client/package.json`]
- Module Federation via `@module-federation/vite` `^1.15.5` (host build) + `@module-federation/runtime` `^2.4.0` (runtime remote registration in `src/mf.ts`). The client is a **pure host / consumer** - `federation({ name: 'client', shared: { react, react-dom singleton } })`, no `exposes`, no build-time `remotes`. [`packages/client/vite.config.ts`, `packages/client/src/mf.ts`]
- One remote is registered at runtime: `my-provider` (`my_provider`) at `http://localhost:5101/remoteEntry.js`, loaded as `type: 'module'` (ESM remoteEntry). It exposes `App`, rendered in `App.tsx` inside a `Suspense` + class error boundary. The `my-provider` remote is **not in this repo** - it is an external vite-built remote. [`packages/client/src/mf.ts`, `packages/client/src/App.tsx`]
- `vite.config.ts` sets `build.target: 'chrome89'`. This matters for Tailwind v4 (see Gotchas).
- No `@nx/vite` / `@nx/react` Vite wiring: `packages/client/project.json` runs bare `vite` / `vite build` through `nx:run-commands`. No `components.json`, no `tsconfig` path aliases, no `src/index.css` today. [`packages/client/project.json`, `packages/client/tsconfig*.json`]
- `@clerk/react` `^6.14.8` and `react-markdown` `^10.1.0` are plain runtime deps and are orthogonal to the styling stack (neither ships CSS nor a Tailwind plugin).

## 1. Tailwind v3 vs v4 with Vite 8

Use **Tailwind CSS v4** with the first-party **`@tailwindcss/vite`** plugin. Current stable is v4.3. [https://tailwindcss.com/docs/installation/using-vite](https://tailwindcss.com/docs/installation/using-vite)

Install `tailwindcss` + `@tailwindcss/vite`, add `tailwindcss()` to `vite.config.ts` plugins, and put a single `@import "tailwindcss";` in your CSS entry - the old `tailwind.config.js` + `@tailwind base/components/utilities` + `postcss.config.js` triad is gone in the v4 Vite path. [https://tailwindcss.com/docs/installation/using-vite](https://tailwindcss.com/docs/installation/using-vite)

The Vite plugin is the recommended integration for Vite-based frameworks; PostCSS (`@tailwindcss/postcss`) is only for build pipelines that are already PostCSS-based and is documented as the fallback, not the default. [https://tailwindcss.com/docs/installation/using-vite](https://tailwindcss.com/docs/installation/using-vite) [https://tailwindcss.com/docs/installation/using-postcss](https://tailwindcss.com/docs/installation/using-postcss)

shadcn/ui has supported Tailwind v4 since Feb 2025 and its Vite guide now assumes v4 + `@tailwindcss/vite` + `@import "tailwindcss"`. [https://ui.shadcn.com/docs/changelog](https://ui.shadcn.com/docs/changelog) [https://ui.shadcn.com/docs/installation/vite](https://ui.shadcn.com/docs/installation/vite)

Why not v3: v3 needs PostCSS + `tailwind.config.js` `content` globbing and its own `autoprefixer`; shadcn's v3 instructions are legacy, and the theme-token model below (`@theme` / CSS-first config) is v4-only. The one reason to stay on v3 is a legacy-browser target - see the `chrome89` note in Gotchas.

Browser floor for v4: **Chrome 111 / Safari 16.4 / Firefox 128**. v4 emits modern CSS (`@property`, `color-mix()`, cascade layers) and is not transpiled down. [https://tailwindcss.com/docs/compatibility](https://tailwindcss.com/docs/compatibility)

Tailwind v4 is not designed to run through Sass/Less/Stylus and CSS Modules are "technically compatible" but discouraged. Neither is in play here. [https://tailwindcss.com/docs/compatibility](https://tailwindcss.com/docs/compatibility)

## 2. shadcn/ui CLI assumptions

**The `shadcn init` CLI will not cleanly auto-run in this Nx workspace.** `init` verifies the project against a fixed list of recognised frameworks (`next`, `vite`, `start`, `react-router`, `laravel`, `astro`); if it cannot detect one it aborts with "We could not detect a supported framework at \<path\>" and points at the manual guide. Unrecognised bundlers/monorepo roots hit this. [https://ui.shadcn.com/docs/cli](https://ui.shadcn.com/docs/cli) [https://github.com/shadcn-ui/ui/issues/5011](https://github.com/shadcn-ui/ui/issues/5011)

Detection keys off framework config/deps in the target `--cwd`. `packages/client` does have a `vite.config.ts`, so `pnpm dlx shadcn@latest init -c packages/client` (or run from inside the dir) *may* succeed as a `vite` project - but the Nx layout (workspace-root `package.json`, `tsconfig.base.json` vs `tsconfig.app.json` split, `pnpm` workspace) is exactly the shape that trips it, so **treat manual configuration as the expected path.** [https://ui.shadcn.com/docs/installation/vite](https://ui.shadcn.com/docs/installation/vite) [https://ui.shadcn.com/docs/installation/manual](https://ui.shadcn.com/docs/installation/manual)

`components.json` fields the CLI reads/writes: `style`, `rsc` (false here - no RSC), `tsx` (true), `tailwind.config` (leave `""` for v4), `tailwind.css` (path to the CSS entry, e.g. `src/styles.css`), `tailwind.baseColor`, `tailwind.cssVariables` (true for the token layer), `aliases` (`components`, `utils`, `ui`, `lib`, `hooks`), `iconLibrary`. [https://ui.shadcn.com/docs/cli](https://ui.shadcn.com/docs/cli) [https://ui.shadcn.com/docs/components-json](https://ui.shadcn.com/docs/components-json)

Import aliases: the CLI requires a working path alias. shadcn's Vite guide uses `@/*` -> `./src/*` set in **both** `tsconfig.json` and `tsconfig.app.json`, plus a matching `resolve.alias` in `vite.config.ts` (`@` -> `path.resolve(__dirname, './src')`). This repo has neither today - both must be added. [https://ui.shadcn.com/docs/installation/vite](https://ui.shadcn.com/docs/installation/vite)

Where components land: `shadcn add <name>` copies component source into your tree at `aliases.ui` (default `@/components/ui`) and pulls npm deps. Components are copied, not imported from a package - you own them. `add` supports names, URLs, local paths, `--all`, `--dry-run`, `-o/--overwrite`. [https://ui.shadcn.com/docs/cli](https://ui.shadcn.com/docs/cli)

Monorepo mode: `shadcn init --monorepo` scaffolds an `apps/* + packages/ui` shape with a `components.json` in each workspace, a shared `packages/ui/src/components`, and cross-workspace aliases like `@workspace/ui/components`; adding is then done from the app dir with `-c apps/web`. All `components.json` files must share the same `style`, `iconLibrary`, and `baseColor`. There is **no Nx-specific documentation** - the monorepo docs only cover the Turborepo-style `apps/`+`packages/` convention. [https://ui.shadcn.com/docs/monorepo](https://ui.shadcn.com/docs/monorepo)

For Scriptorium: given a single consumer today, the simplest correct move is **one `components.json` at `packages/client/` with `@/*` -> `packages/client/src/*` and `ui` -> `@/components/ui`, configured manually.** Promote to a `packages/ui` shared lib + `--monorepo` aliases only when a second package needs the components.

Base library: as of Feb 2026 shadcn ships a **single unified `radix-ui` package** (was dozens of `@radix-ui/react-*`); `pnpm dlx shadcn@latest migrate radix` rewrites imports, no breaking changes. Since **July 2026 new projects default to Base UI** (`--base base`), with Radix still fully supported and selectable via `--base radix`. Pick one explicitly and keep it consistent. [https://ui.shadcn.com/docs/changelog](https://ui.shadcn.com/docs/changelog) [https://ui.shadcn.com/docs/cli](https://ui.shadcn.com/docs/cli)

## 3. Radix UI primitives + React 19

React 19 support landed in shadcn in Oct 2024 and Radix primitives added React 19 to their peer-dependency ranges (`"react": "^16.8 || ^17 || ^18 || ^19"` style). As of early 2026 this is a non-issue with the unified `radix-ui` package. [https://ui.shadcn.com/docs/changelog](https://ui.shadcn.com/docs/changelog) [https://ui.shadcn.com/docs/react-19](https://ui.shadcn.com/docs/react-19)

Package-manager behaviour: **pnpm** (this repo, `pnpm@9.14.4`) only prints a silent peer warning at worst and does not block; `npm` is the one that hard-errors and needs `--force` / `--legacy-peer-deps`. So the repo's pnpm setup is fine. [https://ui.shadcn.com/docs/react-19](https://ui.shadcn.com/docs/react-19)

The historically fragile transitive dep was `react-is` via `recharts` (needs a `react-is` override to match React 19); only relevant if a chart component is added later. [https://ui.shadcn.com/docs/react-19](https://ui.shadcn.com/docs/react-19)

React and react-dom are already declared `shared: { singleton: true }` in the federation config, so host and `my-provider` resolve one React instance - Radix's context-based primitives (which break across duplicate React copies) will work across the federation boundary. [`packages/client/vite.config.ts`]

## 4. Federated CSS / theme-class visibility

**The host's `<html class="dark">` IS visible to remote-rendered components.** Module Federation renders remote components into the *same document and the same React tree* as the host - no iframe, and no Shadow DOM unless the remote explicitly opts in. Host and remote "run on the same page and share a single global CSS scope." So `document.documentElement.classList` (including a `dark` class) is global, and any CSS selector - Tailwind's `.dark` variant, `:root` custom properties - resolves against it for remote DOM nodes just as for host nodes. [https://module-federation.io/guide/basic/css-isolate](https://module-federation.io/guide/basic/css-isolate)

That single global scope is also the isolation problem: MF ships **no built-in style isolation**; the documented strategies are BEM/prefixing, CSS Modules, CSS-in-JS, or the remote wrapping itself in a Shadow DOM web component. A Shadow-DOM remote is the one case where the host stylesheet and the `.dark` class would *not* pierce through - and Tailwind v4 explicitly discourages the Shadow-DOM + CSS Modules route. [https://module-federation.io/guide/basic/css-isolate](https://module-federation.io/guide/basic/css-isolate) [https://tailwindcss.com/docs/compatibility](https://tailwindcss.com/docs/compatibility)

How remote CSS is injected with `@module-federation/vite`: by default the plugin does **not** process CSS assets for exposed modules at all (`bundleAllCSS: false`). Set **`bundleAllCSS: true`** in the *remote's* federation config to bundle every CSS asset into every exposed module; the plugin then emits the CSS with the module and the federation runtime injects it (as `<style>`/`<link>` into `<head>`) when the exposed module loads. Without this, a vite-built remote's Tailwind/component CSS silently never reaches the host. [https://github.com/module-federation/vite](https://github.com/module-federation/vite)

`@module-federation/vite` supports ESM `remoteEntry.js` (`type: 'module'`, as `mf.ts` already uses), React 19, and shared-module tree-shaking. On Vite 8 it uses the Rolldown bundler path (Vite 5-7 = Rollup, Vite 8+ = Rolldown) with version-specific chunking. [https://github.com/module-federation/vite](https://github.com/module-federation/vite)

**Preflight-loads-twice gotcha:** if both the host and `my-provider` each `@import "tailwindcss";`, Tailwind's Preflight (the base reset) plus the full `@theme` token block are injected into `<head>` twice. Duplicate Preflight is mostly idempotent but wastes bytes and can produce specificity/ordering surprises where host and remote utility layers interleave; duplicated `@theme` means whichever stylesheet loads last wins the `:root` token values, so a token drift between host and remote versions becomes a live theming bug. Mitigations, in order of preference:
1. **Host owns the full stylesheet** (`@import "tailwindcss";` + Preflight + `@theme` tokens + `.dark` block). The remote imports **utilities only** and skips Preflight/theme, e.g. `@import "tailwindcss/utilities" layer(utilities);` (v4 lets you import the individual layers). The remote then inherits the host's tokens and `.dark` class for free.
2. Keep the token/`@theme`/`.dark` definitions in a tiny shared CSS file vendored into both builds so the values cannot drift, and still disable Preflight in the remote.
3. Only if the remote must be independently deployable/standalone: let it ship full Tailwind but pin the exact same `tailwindcss` version and token file as the host, and accept the duplicate Preflight.
[https://tailwindcss.com/docs/installation/using-vite](https://tailwindcss.com/docs/installation/using-vite) [https://module-federation.io/guide/basic/css-isolate](https://module-federation.io/guide/basic/css-isolate)

Net for the token/toggle tickets: put `:root` + `.dark` custom properties and the theme toggle in the **host** (toggle just adds/removes `dark` on `document.documentElement`). Remote components written with Tailwind's `dark:` variant and `var(--...)` tokens will theme correctly with no cross-boundary message passing, provided the remote does not Shadow-DOM itself and its build injects its utility CSS (`bundleAllCSS: true`).

## 5. Nx implications

Nx has **no awareness of Tailwind**. There is no Nx plugin step required for the v4 `@tailwindcss/vite` path - it is entirely a Vite plugin concern. The old `@nx/react:setup-tailwind` generator targeted v3 + PostCSS + `tailwind.config.js` and should not be used here. [https://tailwindcss.com/docs/installation/using-vite](https://tailwindcss.com/docs/installation/using-vite)

`packages/client` already bypasses `@nx/vite` (bare `vite` via `nx:run-commands` in `project.json`), so adding `tailwindcss()` to `vite.config.ts` needs no target changes. The `serve`/`build` targets keep working unchanged. [`packages/client/project.json`]

Caching: `nx.json` `namedInputs.default` is `{projectRoot}/**/*`, so a new `components.json`, `src/styles.css`, and `src/components/ui/**` under `packages/client` are automatically part of the `build` cache key. No `nx.json` edit needed unless a shared `packages/ui` lib is introduced later, in which case `client`'s `build` should `dependsOn: ["^build"]` (already the `targetDefaults` default) and the tag rules in `eslint.config` should allow `scope:client` -> `scope:ui`.

Tailwind v4 automatic source detection starts from the CSS file's location and walks the import graph, honouring `.gitignore`. If components are later hoisted to `packages/ui/src`, add an explicit `@source "../../ui/src";` (relative to the CSS file) to the client's stylesheet so utilities used only in the shared lib are not tree-shaken away. [https://tailwindcss.com/docs/detecting-classes-in-source-files](https://tailwindcss.com/docs/detecting-classes-in-source-files)

## Setup recipe

Target: single consumer, tokens + toggle owned by `packages/client` (host), `my-provider` remote consumes them.

1. **Deps** (in `packages/client`): `pnpm add -F @scriptorium/client tailwindcss @tailwindcss/vite` and `pnpm add -F @scriptorium/client class-variance-authority clsx tailwind-merge` (shadcn util deps; `add` will also pull `radix-ui` / Base UI + `lucide-react` per component).
2. **Vite** (`packages/client/vite.config.ts`): add `tailwindcss()` to `plugins` (before/after `react()` is fine), and add
   ```ts
   resolve: { alias: { '@': path.resolve(__dirname, './src') } }
   ```
3. **TS paths**: add `"baseUrl": "."` + `"paths": { "@/*": ["./src/*"] }` to `packages/client/tsconfig.json` **and** `tsconfig.app.json` (whichever the client actually uses for app code).
4. **CSS entry** `packages/client/src/styles.css`:
   ```css
   @import "tailwindcss";
   @custom-variant dark (&:where(.dark, .dark *));

   :root { /* --background, --foreground, --primary, ... shadcn token set */ }
   .dark { /* dark overrides */ }

   @theme inline { /* map --color-background: var(--background); etc. */ }
   ```
   Import it once from `src/bootstrap.tsx` (the federation bootstrap module, so it is present before remotes load).
5. **`packages/client/components.json`** (manual - do not rely on `init` detection):
   ```json
   {
     "$schema": "https://ui.shadcn.com/schema.json",
     "style": "new-york",
     "rsc": false,
     "tsx": true,
     "tailwind": { "config": "", "css": "src/styles.css", "baseColor": "neutral", "cssVariables": true },
     "iconLibrary": "lucide",
     "aliases": {
       "components": "@/components",
       "utils": "@/lib/utils",
       "ui": "@/components/ui",
       "lib": "@/lib",
       "hooks": "@/hooks"
     }
   }
   ```
6. **Add components**: `cd packages/client && pnpm dlx shadcn@latest add button card ...`. If `add` also complains about framework detection, `add` accepts a direct registry URL and writes files per `components.json` regardless.
7. **Theme toggle**: host-only. Toggle `document.documentElement.classList.toggle('dark')`, persist to `localStorage`, set initial class in `index.html` inline script to avoid FOUC.
8. **`my-provider` remote** (external repo, coordinate): its vite config needs `@tailwindcss/vite` with a **utilities-only** import (`@import "tailwindcss/utilities" layer(utilities);`, no Preflight, no `@theme`), and its federation config needs `bundleAllCSS: true` so its utility CSS is injected on load. It must **not** wrap its exposed `App` in a Shadow DOM. It then inherits `:root`/`.dark` tokens from the host.
9. **Nx**: nothing. Confirm `pnpm nx build client` and `pnpm nx serve client` still pass.

## Gotchas

- **`build.target: 'chrome89'` in `packages/client/vite.config.ts` is below Tailwind v4's Chrome 111 / Safari 16.4 / Firefox 128 floor.** v4 output (`@property`, `color-mix()`, cascade layers) is not down-compiled. Either raise the target to `chrome111`/`baseline-widely-available`, or if a sub-111 target is a hard requirement, stay on Tailwind v3. Decide before the token ticket. [https://tailwindcss.com/docs/compatibility](https://tailwindcss.com/docs/compatibility)
- **`shadcn init` will likely abort with "could not detect a supported framework"** in the Nx workspace - configure `components.json` + aliases by hand. [https://github.com/shadcn-ui/ui/issues/5011](https://github.com/shadcn-ui/ui/issues/5011)
- **Remote CSS is silently dropped by default.** `@module-federation/vite` uses `bundleAllCSS: false` - a vite-built remote's styles never reach the host until the remote sets `bundleAllCSS: true`. [https://github.com/module-federation/vite](https://github.com/module-federation/vite)
- **Double Preflight / double `@theme`** if host and remote both `@import "tailwindcss";` - last stylesheet wins the `:root` tokens, so host/remote token drift becomes a theming bug. Host owns full Tailwind; remote imports utilities only. [https://tailwindcss.com/docs/installation/using-vite](https://tailwindcss.com/docs/installation/using-vite)
- **Shadow-DOM remote breaks theming.** If `my-provider` ever isolates itself in a Shadow DOM, the host stylesheet and `<html class="dark">` stop piercing through and tokens must be re-injected into each shadow root. Keep the remote in the light DOM. [https://module-federation.io/guide/basic/css-isolate](https://module-federation.io/guide/basic/css-isolate)
- **No `tailwind.config.js` in v4** - `components.json` `tailwind.config` must be `""`; a stray path makes the CLI look for a file that should not exist. [https://ui.shadcn.com/docs/monorepo](https://ui.shadcn.com/docs/monorepo)
- **Pick Base UI vs Radix explicitly.** Post-July-2026 `init` defaults to Base UI; Scriptorium should choose one `--base` and set the same `style`/`baseColor`/`iconLibrary` in every `components.json`. [https://ui.shadcn.com/docs/changelog](https://ui.shadcn.com/docs/changelog)
- **npm vs pnpm**: the React 19 peer-dep hard error is npm-only; this repo's pnpm is fine, but any contributor running `npm install` in `packages/client` will need `--legacy-peer-deps`. [https://ui.shadcn.com/docs/react-19](https://ui.shadcn.com/docs/react-19)
- **Alias must be added in two places** (`tsconfig` *and* `vite.config.ts`) or `add` writes imports that typecheck but fail at build, or vice versa. [https://ui.shadcn.com/docs/installation/vite](https://ui.shadcn.com/docs/installation/vite)
- **Import the CSS from the federation bootstrap module** (`bootstrap.tsx`), not `index.ts` - `index.ts` is the pre-federation shim and must stay side-effect-light.

## Recommendations affecting the map (#47)

- Adopt **Tailwind v4 + `@tailwindcss/vite`**, not v3/PostCSS - but first resolve the `chrome89` build target (raise it, or accept v3).
- **Configure shadcn manually**: one `components.json` under `packages/client`, `@/*` alias in tsconfig + vite, components copied to `packages/client/src/components/ui`. Defer a shared `packages/ui` lib until a second consumer exists.
- **Tokens + toggle live in the host.** `:root` / `.dark` custom properties + Tailwind `@custom-variant dark` in `packages/client/src/styles.css`; toggle flips `dark` on `<html>`. Remote components inherit this automatically because MF shares one DOM and one CSS scope.
- **Coordinate two things with the `my-provider` remote owner**: (1) `bundleAllCSS: true` in its federation config, (2) utilities-only Tailwind import with no Preflight/`@theme` and no Shadow DOM.
- Radix/React 19 and Nx need **no special handling** on the current pnpm + `nx:run-commands` setup.
