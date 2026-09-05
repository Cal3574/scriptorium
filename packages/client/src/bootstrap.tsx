import './index.css';
import { ClerkProvider } from '@clerk/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { env } from './env';

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');

createRoot(container).render(
  <StrictMode>
    <ClerkProvider publishableKey={env.clerkPublishableKey} afterSignOutUrl="/">
      <App />
    </ClerkProvider>
  </StrictMode>,
);
