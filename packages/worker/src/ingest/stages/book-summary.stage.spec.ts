import { FakeLlmClient } from '@scriptorium/providers';
import type { BookRow } from '@scriptorium/server-core';
import { bookSummaryStage } from './book-summary.stage.js';
import { BOOK_SUMMARY_SYSTEM } from './summary-prompts.js';
import type { StageDeps, StageLogger } from '../stage.js';

const silentLogger: StageLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const book = (over: Partial<BookRow> = {}): BookRow =>
  ({ id: 'book-1', summary: null, ...over }) as BookRow;

function makeDeps(
  chapterSummaries: Array<{ title: string | null; summary: string }>,
  missing = 0,
  llm = new FakeLlmClient({ delayMs: 0 }),
) {
  let written: string | null = null;
  const repo = {
    countChapters: jest.fn(() => Promise.resolve(chapterSummaries.length || 3)),
    countChaptersMissingSummary: jest.fn(() => Promise.resolve(missing)),
    listChapterSummaries: jest.fn(() => Promise.resolve(chapterSummaries)),
    writeBookSummary: jest.fn((_id: string, summary: string) => {
      written = summary;
      return Promise.resolve();
    }),
  };
  const deps = { repo, llm, logger: silentLogger } as unknown as StageDeps;
  return {
    deps,
    repo,
    get written() {
      return written;
    },
  };
}

describe('bookSummaryStage', () => {
  it('is incomplete until books.summary is set and every chapter summary exists', async () => {
    const withMissing = makeDeps([], 2);
    expect(await bookSummaryStage.isComplete(book(), withMissing.deps)).toBe(
      false,
    );
    expect(
      await bookSummaryStage.isComplete(
        book({ summary: 'x' }),
        withMissing.deps,
      ),
    ).toBe(false);

    const done = makeDeps([], 0);
    expect(
      await bookSummaryStage.isComplete(book({ summary: 'x' }), done.deps),
    ).toBe(true);
  });

  it('reduces the chapter summaries into one call with the book system prompt', async () => {
    const llm = new FakeLlmClient({ delayMs: 0 });
    const complete = jest.spyOn(llm, 'complete');
    const { deps } = makeDeps(
      [
        { title: 'Chapter 1. Alpha', summary: 'alpha summary' },
        { title: null, summary: 'beta summary' },
      ],
      0,
      llm,
    );

    await bookSummaryStage.run(book(), deps);

    expect(complete).toHaveBeenCalledTimes(1);
    const req = complete.mock.calls[0][0];
    expect(req.system).toBe(BOOK_SUMMARY_SYSTEM);
    expect(req.maxTokens).toBe(4000);
    expect(req.messages[0].content).toContain('## Chapter 1. Alpha');
    expect(req.messages[0].content).toContain('alpha summary');
    expect(req.messages[0].content).toContain('## Chapter 2');
  });

  it('writes the summary via writeBookSummary', async () => {
    const { deps, repo } = makeDeps([{ title: 'A', summary: 's' }]);
    await bookSummaryStage.run(book(), deps);
    expect(repo.writeBookSummary).toHaveBeenCalledWith(
      'book-1',
      expect.any(String),
    );
  });

  it('fails terminally if there are no chapter summaries', async () => {
    const { deps } = makeDeps([]);
    await expect(bookSummaryStage.run(book(), deps)).rejects.toThrow(
      /no chapter summaries/,
    );
  });
});
