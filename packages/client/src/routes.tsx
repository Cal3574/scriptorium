import { redirect, type RouteObject } from 'react-router';
import { RootLayout } from './root-layout';
import { Library } from './books/Library';
import { BookDetail } from './books/BookDetail';
import { QueryScreen } from './queries/QueryScreen';
import { QueryHistory } from './queries/QueryHistory';

// One layout route wraps the five full-page screens; the index route just
// redirects `/` to `/library` (a data-mode loader redirect, so it never
// renders the shell first). `bootstrap.tsx` feeds this to
// `createBrowserRouter`; the integration test feeds it to `createMemoryRouter`.
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, loader: () => redirect('/library') },
      { path: 'library', element: <Library /> },
      { path: 'books/:bookId', element: <BookDetail /> },
      { path: 'ask', element: <QueryScreen /> },
      { path: 'ask/:queryId', element: <QueryScreen /> },
      { path: 'history', element: <QueryHistory /> },
    ],
  },
];
