import { SignIn, useAuth } from '@clerk/react';
import { Component, Suspense, type ReactNode } from 'react';
import { Outlet } from 'react-router';
import { hasProviderRemote, lazyProvider } from './mf';
import { AppShell } from './components/shell/app-shell';

// ProviderBoundary catches the lazy() rejection that fires when a provider's
// remoteEntry.js can't be fetched (provider not running, network error,
// etc.). Without it any one missing provider unmounts the whole consumer
// tree. React has no built-in functional error boundary so this is a class.
class ProviderBoundary extends Component<
  { children: ReactNode; name: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div role="alert">
          <p>
            Provider &quot;{this.props.name}&quot; unavailable:{' '}
            {this.state.error.message}
          </p>
        </div>
      );
    }
    return (
      <Suspense fallback={<p>Loading {this.props.name}...</p>}>
        {this.props.children}
      </Suspense>
    );
  }
}

// Only built when the optional external remote is configured (see mf.ts), so
// an unset `VITE_PROVIDER_REMOTE_URL` never reaches `loadRemote()`.
const ProviderMyProvider = hasProviderRemote
  ? lazyProvider('my-provider', 'App')
  : null;

// The layout route: the real app shell (top bar + centred content column,
// #61) wrapping every screen. `<Outlet />` is the active screen; screen-swap
// state that used to live here is now the URL.
function Shell() {
  return (
    <AppShell>
      <Outlet />
      {ProviderMyProvider && (
        <ProviderBoundary name="my-provider">
          <ProviderMyProvider />
        </ProviderBoundary>
      )}
    </AppShell>
  );
}

export function RootLayout() {
  // Core 3 dropped <SignedIn>/<SignedOut>; gate on the hook instead. An
  // unauthenticated visitor only ever sees <SignIn />.
  const { isLoaded, isSignedIn } = useAuth();

  return (
    <main>
      {!isLoaded ? <p>Loading...</p> : isSignedIn ? <Shell /> : <SignIn />}
    </main>
  );
}

export default RootLayout;
