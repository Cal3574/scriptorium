import { FakeObjectStorage } from '@scriptorium/providers';
import type { BookRow } from '../books/books.repository.js';
import {
  extractionArtifactKey,
  requireExtractionArtifact,
  saveExtractionArtifact,
  type ExtractionArtifact,
} from './extraction-artifact.js';

function bookRow(overrides: Partial<BookRow> = {}): BookRow {
  return {
    id: 'book-1',
    userId: 'user-1',
    s3Key: 'books/user-1/test.pdf',
    ...overrides,
  } as BookRow;
}

function artifact(): ExtractionArtifact {
  return {
    pages: [{ page: 1, markdown: 'hello' }],
    items: [],
    outline: [],
    metadata: { title: null, author: null },
    pageCount: 1,
  } as ExtractionArtifact;
}

describe('extractionArtifactKey', () => {
  it('swaps the .pdf suffix for .extraction.json', () => {
    expect(extractionArtifactKey(bookRow())).toBe(
      'books/user-1/test.extraction.json',
    );
  });

  it('appends when the key does not end in .pdf', () => {
    expect(extractionArtifactKey(bookRow({ s3Key: 'books/u/raw' }))).toBe(
      'books/u/raw.extraction.json',
    );
  });
});

describe('requireExtractionArtifact', () => {
  const boom = () => new Error('boom');

  it('returns the saved sidecar', async () => {
    const storage = new FakeObjectStorage();
    const book = bookRow();
    await saveExtractionArtifact(
      storage,
      extractionArtifactKey(book),
      artifact(),
    );

    await expect(
      requireExtractionArtifact(storage, book, boom),
    ).resolves.toMatchObject({ pageCount: 1 });
  });

  it('throws the caller-supplied error, built from the book, when missing', async () => {
    class Boom extends Error {}
    await expect(
      requireExtractionArtifact(
        new FakeObjectStorage(),
        bookRow(),
        (b) => new Boom(`gone: ${b.id}`),
      ),
    ).rejects.toThrow(/^gone: book-1$/);
  });
});
