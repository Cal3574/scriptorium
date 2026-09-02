import { chunkText } from './chunk-text.js';

// A cheap deterministic stand-in for the BPE encoder: one "token" per
// whitespace-delimited word. Keeps the assertions readable.
const countTokens = (text: string): number =>
  text.trim() === '' ? 0 : text.trim().split(/\s+/).length;

const words = (n: number, tag: string): string =>
  Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ');

describe('chunkText', () => {
  it('returns nothing for empty text', () => {
    expect(chunkText('   \n\n  ', { countTokens })).toEqual([]);
  });

  it('keeps a short chapter as a single chunk', () => {
    const text = `${words(20, 'a')}\n\n${words(20, 'b')}`;
    const chunks = chunkText(text, { countTokens, targetTokens: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].tokenCount).toBe(40);
  });

  it('splits on paragraph boundaries near the target size', () => {
    const paras = [0, 1, 2, 3, 4].map((i) => words(50, `p${i}_`));
    const chunks = chunkText(paras.join('\n\n'), {
      countTokens,
      targetTokens: 120,
      overlapTokens: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // No chunk splits a paragraph: every line belongs to one `pN_` group.
      const tags = new Set(
        chunk.text.split(/\s+/).map((w) => w.replace(/\d+$/, '')),
      );
      expect(tags.size).toBeLessThanOrEqual(2);
    }
  });

  it('overlaps consecutive chunks by whole trailing paragraphs', () => {
    const paras = [0, 1, 2, 3].map((i) => words(50, `p${i}_`));
    const chunks = chunkText(paras.join('\n\n'), {
      countTokens,
      targetTokens: 110,
      overlapTokens: 40,
    });
    expect(chunks.length).toBeGreaterThan(1);
    const firstTail = chunks[0].text.split('\n\n').at(-1);
    expect(chunks[1].text.startsWith(firstTail ?? '<none>')).toBe(true);
  });

  it('sentence-splits a single oversized paragraph', () => {
    const paragraph = Array.from(
      { length: 10 },
      (_, i) => `Sentence number ${i} has five words.`,
    ).join(' ');
    const chunks = chunkText(paragraph, {
      countTokens,
      targetTokens: 12,
      overlapTokens: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks)
      expect(chunk.tokenCount).toBeLessThanOrEqual(12);
  });
});
