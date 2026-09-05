import type { ReactNode } from 'react';

import { TopBar } from './top-bar';

// The app shell: the themed `TopBar` above, and every screen body in a centred
// `--container-app` column below it (#51). `children` is the routed `<Outlet />`
// supplied by the layout route.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-foreground min-h-dvh">
      <TopBar />
      <div className="mx-auto w-full max-w-(--container-app) px-(--shell-gutter) py-8">
        {children}
      </div>
    </div>
  );
}
