import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from './routes';
import { ClerkGate } from './clerk-gate';
import { ThemeProvider } from './theme';

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');

// Data-mode router: the route tree is data, mounted with <RouterProvider>.
// It sits under <ClerkProvider> (from ClerkGate) so screens can read auth,
// and under <ThemeProvider> which stays the outermost provider.
const router = createBrowserRouter(routes);

// ThemeProvider is the outermost provider so ClerkGate (and anything else)
// can read the theme; the pre-paint script in index.html has already set the
// DOM class, so the first React render matches the first paint.
createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <ClerkGate>
        <RouterProvider router={router} />
      </ClerkGate>
    </ThemeProvider>
  </StrictMode>,
);
