import type { ReactElement } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { BookListItemDto } from '@scriptorium/contracts';

import { IngestTimeline } from './ingest-timeline';
import type { IngestProgress } from '@/books/use-ingest-events';

afterEach(cleanup);

const book = (over: Partial<BookListItemDto> = {}): BookListItemDto =>
  ({
    id: 'b1',
    title: 'Deep Work',
    author: null,
    originalFilename: 'deep-work.pdf',
    fileSizeBytes: null,
    pageCount: null,
    status: 'embedding',
    failedStage: null,
    failureReason: null,
    summaryGeneratedAt: null,
    createdAt: new Date(Date.now() - 90_000).toISOString(),
    ...over,
  }) as BookListItemDto;

const progress = (over: Partial<IngestProgress> = {}): IngestProgress =>
  ({
    status: 'embedding',
    stage: 'embedding',
    progress: { done: 120, total: 400, unit: 'chunks' },
    chaptersTotal: 0,
    chaptersSummarized: 0,
    title: 'Deep Work',
    author: null,
    failedStage: null,
    failureReason: null,
    ...over,
  }) as IngestProgress;

function renderPanel(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

test('shows the running step with its live count and a Live badge', () => {
  renderPanel(
    <IngestTimeline book={book()} progress={progress()} connected={true} />,
  );

  const region = screen.getByRole('status');
  expect(region).toHaveTextContent('Build the meaning space');
  expect(region).toHaveTextContent('120 / 400 chunks');
  expect(region).toHaveTextContent(/live/i);
  expect(region).toHaveTextContent(/started 1m 30s ago/i);
});

test('reconnecting when the stream is disconnected', () => {
  renderPanel(
    <IngestTimeline book={book()} progress={progress()} connected={false} />,
  );
  expect(screen.getByRole('status')).toHaveTextContent(/reconnecting/i);
});

test('on completion, offers a link to the summary', () => {
  renderPanel(
    <IngestTimeline
      book={book({ status: 'ready' })}
      progress={progress({ status: 'ready', stage: null })}
      connected={true}
    />,
  );

  expect(screen.getByText('Summary ready')).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'Read the summary' }),
  ).toHaveAttribute('href', '/books/b1');
  expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
});

test('on failure, shows the reason and a working Retry button', async () => {
  const onRetry = jest.fn();
  renderPanel(
    <IngestTimeline
      book={book({
        status: 'failed',
        failedStage: 'embed',
        failureReason: 'the embedding provider timed out',
      })}
      progress={null}
      connected={false}
      onRetry={onRetry}
    />,
  );

  const region = screen.getByRole('status');
  expect(region).toHaveTextContent('the embedding provider timed out');

  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('surfaces a retry failure inline', async () => {
  const onRetry = jest.fn().mockRejectedValue(new Error('retry failed: 500'));
  renderPanel(
    <IngestTimeline
      book={book({ status: 'failed', failedStage: 'embed' })}
      progress={null}
      connected={false}
      onRetry={onRetry}
    />,
  );

  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'retry failed: 500',
  );
});
