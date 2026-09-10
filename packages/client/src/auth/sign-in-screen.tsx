import { SignIn } from '@clerk/react';

import { Monogram } from '@/components/shell/monogram';
import { ThemeToggle } from '@/components/shell/theme-toggle';

// The signed-out screen. An unauthenticated visitor never reaches the app
// shell (top bar + nav), so the branding the shell would normally supply is
// staged here instead: the Scriptorium mark and wordmark, the one-line
// product promise, and the Clerk `<SignIn>` card centred beneath them. The
// theme toggle is pinned top-right so the same light/dark control is present
// before sign-in as after. Everything styles through the #52 tokens, so dark
// mode is a free recompute.
export function SignInScreen() {
  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col items-center px-(--shell-gutter) py-16">
      <div className="absolute right-(--shell-gutter) top-4">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="mb-8 flex flex-col items-center text-center">
          <Monogram className="size-12" />
          <h1 className="text-foreground mt-4 font-serif text-2xl font-medium tracking-tight">
            Scriptorium
          </h1>
          <p className="text-muted-foreground mt-2 max-w-xs text-sm">
            Chapter-by-chapter summaries of the books you read, searchable
            across your whole library.
          </p>
        </div>

        <SignIn />
      </div>
    </div>
  );
}
