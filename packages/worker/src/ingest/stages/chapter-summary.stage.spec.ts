import { FakeLlmClient, FakeObjectStorage } from '@scriptorium/providers';
import type { BookRow } from '@scriptorium/server-core';
import { chapterSummaryStage } from './chapter-summary.stage.js';
import { TerminalIngestError } from '../errors.js';
import { CHAPTER_SUMMARY_SYSTEM } from './summary-prompts.js';
import {
  extractionArtifactKey,
  saveExtractionArtifact,
  type ExtractionArtifact,
} from './extraction-artifact.js';
import type { StageDeps, StageLogger } from '../stage.js';

const silentLogger: StageLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function bookRow(): BookRow {
  return {
    id: 'book-1',
    userId: 'user-1',
    title: 'The Test Book',
    originalFilename: 'test.pdf',
    s3Key: 'books/user-1/test.pdf',
    status: 'summarizing',
    extractedMarkdownKey: 'books/user-1/test.md',
  } as BookRow;
}

function artifact(): ExtractionArtifact {
  const pages = Array.from({ length: 12 }, (_, i) => ({
    page: i + 1,
    markdown: `# Page ${i + 1}\n\nSome prose on page ${i + 1} with enough words to slice.`,
  }));
  return {
    pages,
    items: [],
    outline: [],
    metadata: { title: 'The Test Book', author: null },
    pageCount: 12,
  };
}

function makeDeps(
  chapters: Array<{
    id: string;
    chapterIndex: number;
    title: string | null;
    pageStart: number | null;
    pageEnd: number | null;
  }>,
  storage: FakeObjectStorage,
  llm = new FakeLlmClient({ delayMs: 0 }),
) {
  const summaries = new Map<string, string>();
  const repo = {
    countChapters: jest.fn(() => Promise.resolve(chapters.length)),
    countChaptersMissingSummary: jest.fn(() =>
      Promise.resolve(chapters.length - summaries.size),
    ),
    listChaptersMissingSummary: jest.fn(() =>
      Promise.resolve(chapters.filter((c) => !summaries.has(c.id))),
    ),
    writeChapterSummary: jest.fn((id: string, summary: string) => {
      summaries.set(id, summary);
      return Promise.resolve();
    }),
  };
  const events = { stageProgress: jest.fn(() => Promise.resolve()) };
  const deps = {
    repo,
    storage,
    llm,
    events,
    logger: silentLogger,
  } as unknown as StageDeps;
  return { deps, repo, events, summaries };
}

const chapter = (i: number, title: string | null) => ({
  id: `ch${i}`,
  chapterIndex: i,
  title,
  pageStart: i * 3 + 1,
  pageEnd: i * 3 + 3,
});

describe('chapterSummaryStage', () => {
  it('is incomplete while a chapter has no summary, complete once all do', async () => {
    const { deps, repo } = makeDeps([chapter(0, 'A')], new FakeObjectStorage());
    expect(await chapterSummaryStage.isComplete(bookRow(), deps)).toBe(false);
    (repo.countChaptersMissingSummary as jest.Mock).mockResolvedValueOnce(0);
    expect(await chapterSummaryStage.isComplete(bookRow(), deps)).toBe(true);
  });

  it('writes a deep-dive per missing chapter using the chapter system prompt', async () => {
    const storage = new FakeObjectStorage();
    const book = bookRow();
    await saveExtractionArtifact(
      storage,
      extractionArtifactKey(book),
      artifact(),
    );
    const llm = new FakeLlmClient({ delayMs: 0 });
    const complete = jest.spyOn(llm, 'complete');
    const { deps, summaries } = makeDeps(
      [chapter(0, 'Chapter 1. Alpha'), chapter(1, 'Chapter 2. Beta')],
      storage,
      llm,
    );

    await chapterSummaryStage.run(book, deps);

    expect(summaries.size).toBe(2);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0][0].system).toBe(CHAPTER_SUMMARY_SYSTEM);
    expect(complete.mock.calls[0][0].maxTokens).toBe(4000);
    expect(complete.mock.calls[0][0].messages[0].content).toContain(
      'Chapter: Chapter 1. Alpha',
    );
  });

  it('only re-summarises the chapters still missing a summary', async () => {
    const storage = new FakeObjectStorage();
    const book = bookRow();
    await saveExtractionArtifact(
      storage,
      extractionArtifactKey(book),
      artifact(),
    );
    const { deps, repo, summaries } = makeDeps(
      [chapter(0, 'A'), chapter(1, 'B'), chapter(2, 'C')],
      storage,
    );
    summaries.set('ch0', 'already done');
    (repo.listChaptersMissingSummary as jest.Mock).mockResolvedValueOnce([
      chapter(1, 'B'),
      chapter(2, 'C'),
    ]);

    await chapterSummaryStage.run(book, deps);

    expect(repo.writeChapterSummary).toHaveBeenCalledTimes(2);
    expect(summaries.get('ch0')).toBe('already done');
  });

  it('fails terminally when the extraction sidecar is missing', async () => {
    const { deps } = makeDeps([chapter(0, 'A')], new FakeObjectStorage());
    await expect(chapterSummaryStage.run(bookRow(), deps)).rejects.toThrow(
      /extraction sidecar is missing/,
    );
  });

  it('propagates an LLM failure so the book fails', async () => {
    const storage = new FakeObjectStorage();
    const book = bookRow();
    await saveExtractionArtifact(
      storage,
      extractionArtifactKey(book),
      artifact(),
    );
    const llm = new FakeLlmClient({ delayMs: 0 });
    jest
      .spyOn(llm, 'complete')
      .mockRejectedValue(new TerminalIngestError('llm down'));
    const { deps } = makeDeps([chapter(0, 'A')], storage, llm);

    await expect(chapterSummaryStage.run(book, deps)).rejects.toThrow(
      'llm down',
    );
  });
});
