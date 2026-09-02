import { FakeLlmClient, FakeObjectStorage } from '@scriptorium/providers';
import type { BookRow } from '@scriptorium/server-core';
import { chunkStage } from './chunk.stage.js';
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

function bookRow(over: Partial<BookRow> = {}): BookRow {
  return {
    id: 'book-1',
    userId: 'user-1',
    title: 'The Test Book',
    author: null,
    originalFilename: 'test.pdf',
    s3Key: 'books/user-1/test.pdf',
    status: 'chunking',
    extractedMarkdownKey: 'books/user-1/test.md',
    ...over,
  } as BookRow;
}

const para = (tag: string) =>
  `${tag} paragraph. It has a couple of sentences of prose so the chunker ` +
  `has something real to slice into token-sized pieces without trouble.`;

function artifact(): ExtractionArtifact {
  const pages = [];
  for (let n = 1; n <= 24; n++) {
    if (n === 3)
      pages.push({ page: n, markdown: `## Chapter 1. Alpha\n\n${para('a')}` });
    else if (n === 11)
      pages.push({ page: n, markdown: `## Chapter 2. Beta\n\n${para('b')}` });
    else if (n === 18)
      pages.push({ page: n, markdown: `## Chapter 3. Gamma\n\n${para('c')}` });
    else pages.push({ page: n, markdown: para(`p${n}`) });
  }
  return {
    pages,
    items: [
      { type: 'heading', level: 2, text: 'Chapter 1. Alpha', page: 3 },
      { type: 'heading', level: 2, text: 'Chapter 2. Beta', page: 11 },
      { type: 'heading', level: 2, text: 'Chapter 3. Gamma', page: 18 },
    ],
    outline: [],
    metadata: { title: 'The Test Book', author: null },
    pageCount: 24,
  };
}

interface CapturedWrite {
  bookId: string;
  userId: string;
  bookTitle: string;
  chapters: Array<{
    chapterIndex: number;
    title: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    chunkRowChapterTitle: string;
    chunks: Array<{ chunkText: string; tokenCount: number | null }>;
  }>;
}

function makeDeps(storage: FakeObjectStorage) {
  const writes: CapturedWrite[] = [];
  let chapterRows = 0;
  const repo = {
    hasChapters: jest.fn(() => Promise.resolve(chapterRows > 0)),
    writeChaptersAndChunks: jest.fn((input: CapturedWrite) => {
      writes.push(input);
      chapterRows += input.chapters.length;
      return Promise.resolve();
    }),
  };
  const deps = {
    repo,
    storage,
    llm: new FakeLlmClient({ delayMs: 0 }),
    logger: silentLogger,
  } as unknown as StageDeps;
  return { deps, writes, repo };
}

describe('chunkStage', () => {
  it('is incomplete until chapter rows exist, then complete', async () => {
    const { deps } = makeDeps(new FakeObjectStorage());
    const book = bookRow();
    expect(await chunkStage.isComplete(book, deps)).toBe(false);
    (deps.repo.hasChapters as jest.Mock).mockResolvedValueOnce(true);
    expect(await chunkStage.isComplete(book, deps)).toBe(true);
  });

  it('detects chapters and writes paragraph-aligned chunks with null embeddings', async () => {
    const storage = new FakeObjectStorage();
    const book = bookRow();
    await saveExtractionArtifact(
      storage,
      extractionArtifactKey(book),
      artifact(),
    );
    const { deps, writes } = makeDeps(storage);

    await chunkStage.run(book, deps);

    expect(writes).toHaveLength(1);
    const write = writes[0];
    expect(write.bookTitle).toBe('The Test Book');
    expect(write.chapters.map((c) => c.title)).toEqual([
      'Chapter 1. Alpha',
      'Chapter 2. Beta',
      'Chapter 3. Gamma',
    ]);
    expect(write.chapters[0]).toMatchObject({
      chapterIndex: 0,
      pageStart: 3,
      pageEnd: 10,
      chunkRowChapterTitle: 'Chapter 1. Alpha',
    });
    expect(write.chapters[2].pageEnd).toBe(24);
    const allChunks = write.chapters.flatMap((c) => c.chunks);
    expect(allChunks.length).toBeGreaterThan(0);
    expect(allChunks.every((c) => (c.tokenCount ?? 0) > 0)).toBe(true);
  });

  it('fails terminally when the extraction sidecar is missing', async () => {
    const { deps } = makeDeps(new FakeObjectStorage());
    await expect(chunkStage.run(bookRow(), deps)).rejects.toThrow(
      /extraction sidecar is missing/,
    );
  });

  it('falls back to the filename for book_title when the book has no title', async () => {
    const storage = new FakeObjectStorage();
    const book = bookRow({ title: null });
    await saveExtractionArtifact(
      storage,
      extractionArtifactKey(book),
      artifact(),
    );
    const { deps, writes } = makeDeps(storage);

    await chunkStage.run(book, deps);

    expect(writes[0].bookTitle).toBe('test.pdf');
  });
});
