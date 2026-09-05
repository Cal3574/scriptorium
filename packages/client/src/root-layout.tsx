import { SignIn, useAuth, UserButton } from '@clerk/react';
import {
  Component,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import type { UserDto } from '@scriptorium/contracts';
import { lazyProvider } from './mf';
import { env } from './env';
import { useApi } from './auth/use-api';
import { ThemeToggle } from './theme';

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

const ProviderMyProvider = lazyProvider('my-provider', 'App');

function Identity() {
  const api = useApi();
  const [me, setMe] = useState<UserDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api('/api/v1/me')
      .then(async (res) => {
        if (!res.ok) throw new Error(`me failed: ${res.status}`);
        return (await res.json()) as UserDto;
      })
      .then((user) => !cancelled && setMe(user))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (error) return <p role="alert">{error}</p>;
  if (!me) return <p>Loading your account...</p>;
  return (
    <p>
      Signed in as {me.email} (id {me.id})
    </p>
  );
}

// The three sections, in fixed order. #61 turns this into the real top bar;
// for now it is a plain row of router links whose active state tracks the URL.
const NAV = [
  { to: '/library', label: 'Library' },
  { to: '/ask', label: 'Ask' },
  { to: '/history', label: 'History' },
] as const;

// The layout route: the shell that wraps every screen. `<Outlet />` is the
// active screen; screen-swap state that used to live here is now the URL.
function Shell() {
  return (
    <>
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span
          style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline' }}
        >
          <Link to="/">
            <h1 style={{ display: 'inline' }}>Scriptorium</h1>
          </Link>
          <nav style={{ display: 'flex', gap: '0.5rem' }}>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                style={({ isActive }) => ({
                  fontWeight: isActive ? 700 : 400,
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </span>
        <span style={{ display: 'flex', gap: '0.5rem' }}>
          <ThemeToggle />
          <UserButton />
        </span>
      </header>
      <p>API: {env.apiUrl}</p>
      <Identity />
      <Outlet />
      <ProviderBoundary name="my-provider">
        <ProviderMyProvider />
      </ProviderBoundary>
    </>
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
