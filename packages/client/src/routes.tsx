import { redirect, type RouteObject } from 'react-router';
import { RootLayout } from './root-layout';
import { Library } from './books/Library';
import { BookDetail } from './books/BookDetail';
import { QueryHistory } from './queries/QueryHistory';
import { QueryDetailScreen } from './queries/QueryDetailScreen';
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
        // Marks this route (and its chapter children, via match inheritance)
        // as "the reader" for the chat widget's `lastBookId` tracking
        // (#159), so that lookup keys off the route tree instead of a
        // hand-rolled path pattern.
        handle: { isReaderRoute: true },
        children: [
          { index: true, element: <ReaderOverview /> },
          { path: ':chapterNumber', element: <ReaderChapter /> },
        ],
      },
      // #167: the `/ask` screen is deleted now that the widget's Ask
      // library tab covers it; old deep links redirect rather than 404,
      // matching the `/` -> `/library` idiom above.
      { path: 'ask', loader: () => redirect('/library') },
      {
        path: 'ask/:queryId',
        loader: ({ params }) => redirect(`/history/${params.queryId}`),
      },
      {
        path: 'history',
        element: <QueryHistory />,
        handle: { title: 'History' },
      },
      {
        // #166: QueryDetail relocated under the History route tree, since it
        // had no code dependency on QueryScreen (deleted in #167).
        path: 'history/:queryId',
        element: <QueryDetailScreen />,
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
