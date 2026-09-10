import { redirect, type RouteObject } from 'react-router';
import { RootLayout } from './root-layout';
import { Library } from './books/Library';
import { BookDetail } from './books/BookDetail';
import { QueryScreen } from './queries/QueryScreen';
import { QueryHistory } from './queries/QueryHistory';
import { ActivityScreen } from './activity/ActivityScreen';
import { PricingScreen } from './pricing/PricingScreen';
import { HowItWorks } from './how-it-works/HowItWorks';
import { ReaderLayout } from './reader/ReaderLayout';
import { ReaderOverview } from './reader/ReaderOverview';
import { ReaderChapter } from './reader/ReaderChapter';

// One layout route wraps the full-page screens; the index route just
// redirects `/` to `/library` (a data-mode loader redirect, so it never
// renders the shell first). `bootstrap.tsx` feeds this to
// `createBrowserRouter`; the integration test feeds it to `createMemoryRouter`.
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, loader: () => redirect('/library') },
      {
        path: 'library',
        element: <Library />,
        handle: { title: 'Library' },
      },
      { path: 'books/:bookId', element: <BookDetail /> },
      {
        // The reader (#136 / #138): a nested layout so the TOC sidebar and the
        // single <ScrollRestoration> are shared by the overview and chapter
        // screens. `:chapterNumber` is 1-based.
        path: 'books/:bookId/read',
        element: <ReaderLayout />,
        children: [
          { index: true, element: <ReaderOverview /> },
          { path: ':chapterNumber', element: <ReaderChapter /> },
        ],
      },
      { path: 'ask', element: <QueryScreen />, handle: { title: 'Ask' } },
      {
        path: 'ask/:queryId',
        element: <QueryScreen />,
        handle: { title: 'Ask' },
      },
      {
        path: 'history',
        element: <QueryHistory />,
        handle: { title: 'History' },
      },
      {
        path: 'activity',
        element: <ActivityScreen />,
        handle: { title: 'Activity' },
      },
      {
        path: 'pricing',
        element: <PricingScreen />,
        handle: { title: 'Plans' },
      },
      {
        path: 'how-it-works',
        element: <HowItWorks />,
        handle: { title: 'How it works' },
      },
    ],
  },
];
