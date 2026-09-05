import {
  type Candidate,
  selectChunks,
  type SelectionConfig,
} from './select-chunks.js';

const config: SelectionConfig = {
  topK: 12,
  maxPerBook: 6,
  minSimilarity: 0.25,
  minResults: 3,
  lowConfidenceK: 4,
};

// Build a candidate at a given similarity. `book` defaults so single-book
// cases stay terse.
const cand = (
  similarity: number,
  book = 'book-a',
  id = `c${similarity}`,
): Candidate => ({
  chunkId: id,
  bookId: book,
  bookTitle: book,
  chapterTitle: 'ch',
  chunkText: 'text',
  similarity,
});

describe('selectChunks', () => {
  describe('per-book cap with backfill', () => {
    it('pushes a monopolising book past maxPerBook to the back so other books rank first', () => {
      const candidates: Candidate[] = [
        ...Array.from({ length: 10 }, (_, i) =>
          cand(0.9 - i * 0.01, 'book-a', `a${i}`),
        ),
        ...Array.from({ length: 4 }, (_, i) =>
          cand(0.5 - i * 0.01, 'book-b', `b${i}`),
        ),
      ];
      const { selected } = selectChunks(candidates, config);
      // Cap 6 on book-a: a0..a5, then all of book-b, then the a6+ leftovers
      // backfill to topK. book-b is never starved.
      expect(selected.slice(0, 10).map((c) => c.chunkId)).toEqual([
        'a0',
        'a1',
        'a2',
        'a3',
        'a4',
        'a5',
        'b0',
        'b1',
        'b2',
        'b3',
      ]);
      expect(selected).toHaveLength(12);
    });

    it('backfills from the leftover book when the pool is otherwise short of topK', () => {
      // Only one book: the cap must not starve a single-book question.
      const candidates = Array.from({ length: 15 }, (_, i) =>
        cand(0.9 - i * 0.01, 'book-a', `a${i}`),
      );
      const { selected, lowConfidence } = selectChunks(candidates, config);
      expect(selected).toHaveLength(12);
      expect(lowConfidence).toBe(false);
    });

    it('keeps the capped primary chunks ahead of the backfilled leftovers', () => {
      const candidates: Candidate[] = [
        ...Array.from({ length: 8 }, (_, i) =>
          cand(0.9 - i * 0.01, 'book-a', `a${i}`),
        ),
        cand(0.4, 'book-b', 'b0'),
      ];
      const { selected } = selectChunks(candidates, config);
      // a0..a5 (cap 6), then b0, then a6, a7 (leftovers).
      expect(selected.map((c) => c.chunkId)).toEqual([
        'a0',
        'a1',
        'a2',
        'a3',
        'a4',
        'a5',
        'b0',
        'a6',
        'a7',
      ]);
    });
  });

  describe('similarity floor', () => {
    it('drops chunks below the floor and takes at most topK', () => {
      const candidates = [
        cand(0.6, 'book-a', 'a'),
        cand(0.4, 'book-a', 'b'),
        cand(0.3, 'book-a', 'c'),
        cand(0.24, 'book-a', 'd'),
        cand(0.1, 'book-a', 'e'),
      ];
      const { selected, lowConfidence } = selectChunks(candidates, config);
      expect(selected.map((c) => c.chunkId)).toEqual(['a', 'b', 'c']);
      expect(lowConfidence).toBe(false);
    });

    it('caps the above-floor set at topK', () => {
      const candidates = Array.from({ length: 20 }, (_, i) =>
        cand(0.9, `book-${i}`, `c${i}`),
      );
      const { selected } = selectChunks(candidates, config);
      expect(selected).toHaveLength(12);
    });
  });

  describe('low-confidence fallback', () => {
    it('clears the floor and takes the top lowConfidenceK when too few clear it', () => {
      const candidates = [
        cand(0.3, 'book-a', 'a'),
        cand(0.2, 'book-a', 'b'),
        cand(0.15, 'book-a', 'c'),
        cand(0.1, 'book-a', 'd'),
        cand(0.05, 'book-a', 'e'),
      ];
      const { selected, lowConfidence } = selectChunks(candidates, config);
      expect(lowConfidence).toBe(true);
      expect(selected.map((c) => c.chunkId)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('is not low-confidence at exactly minResults above the floor', () => {
      const candidates = [
        cand(0.5, 'book-a', 'a'),
        cand(0.4, 'book-a', 'b'),
        cand(0.25, 'book-a', 'c'),
        cand(0.1, 'book-a', 'd'),
      ];
      const { selected, lowConfidence } = selectChunks(candidates, config);
      expect(lowConfidence).toBe(false);
      expect(selected.map((c) => c.chunkId)).toEqual(['a', 'b', 'c']);
    });

    it('flags low-confidence and returns an empty set for an empty pool', () => {
      const { selected, lowConfidence } = selectChunks([], config);
      expect(selected).toEqual([]);
      expect(lowConfidence).toBe(true);
    });
  });
});
