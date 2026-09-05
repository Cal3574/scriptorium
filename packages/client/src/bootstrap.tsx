import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ClerkGate } from './clerk-gate';
import { ThemeProvider } from './theme';

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');

// ThemeProvider is the outermost provider so ClerkGate (and anything else)
// can read the theme; the pre-paint script in index.html has already set the
// DOM class, so the first React render matches the first paint.
createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <ClerkGate>
        <App />
      </ClerkGate>
    </ThemeProvider>
  </StrictMode>,
);
