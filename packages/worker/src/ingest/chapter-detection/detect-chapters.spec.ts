import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectChapters,
  type DetectedChapter,
  type DetectionInput,
} from './detect-chapters.js';

const FIXTURE_DIR = join(__dirname, 'fixtures');

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf-8')) as T;
}

// Seam 3: the pure detector against a committed case table. Each
// `*.detection-input.json` has a sibling `*.expected.json`; no `resolveGapTitle`
// hook, so a synthesised gap the outline cannot name falls through to
// `Chapter N`.
describe('detectChapters - fixture case table (Seam 3)', () => {
  const cases = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.detection-input.json'))
    .map((f) => f.replace('.detection-input.json', ''));

  it.each(cases)('%s', async (name) => {
    const input = load<DetectionInput>(`${name}.detection-input.json`);
    const expected = load<DetectedChapter[]>(`${name}.expected.json`);
    await expect(detectChapters(input)).resolves.toEqual(expected);
  });

  it('covers the five required cases', () => {
    expect(cases.sort()).toEqual(
      [
        'author-name-headings',
        'missing-chapter-one',
        'sparse-markers',
        'toc-exclusion',
        'zero-structure',
      ].sort(),
    );
  });
});

// A minimal input the focused unit tests below extend.
function baseInput(over: Partial<DetectionInput> = {}): DetectionInput {
  return {
    pages: [{ page: 1, markdown: 'Opening prose for the body.' }],
    items: [],
    outline: [],
    metadata: { title: null, author: null },
    pageCount: 10,
    ...over,
  };
}

const heading = (level: number, text: string, page: number) => ({
  type: 'heading' as const,
  level,
  text,
  page,
});

describe('detectChapters - markers', () => {
  it('ignores heading level: a `#` and a `##` marker are treated alike', async () => {
    const chapters = await detectChapters(
      baseInput({
        pageCount: 20,
        items: [
          heading(1, 'Chapter 1. First', 2),
          heading(3, 'Chapter 2. Second', 11),
        ],
      }),
    );
    expect(chapters.map((c) => c.title)).toEqual([
      'Chapter 1. First',
      'Chapter 2. Second',
    ]);
  });

  it('rejects a heading with a trailing dot-leader page number', async () => {
    const chapters = await detectChapters(
      baseInput({
        pageCount: 20,
        items: [
          heading(2, 'Chapter 1. Real Heading', 3),
          heading(2, 'Chapter 2. Toc Line .......... 44', 3),
          heading(2, 'Chapter 3. Also Real', 12),
        ],
      }),
    );
    expect(chapters).toHaveLength(3); // ch1, synthesised ch2, ch3
    expect(chapters[1].title).toBe('Chapter 2');
  });

  it('drops markers longer than 60 characters', async () => {
    const long = `Chapter 2. ${'x'.repeat(70)}`;
    const chapters = await detectChapters(
      baseInput({
        pageCount: 20,
        items: [
          heading(2, 'Chapter 1. Fine', 2),
          heading(2, long, 8),
          heading(2, 'Chapter 3. Fine', 14),
        ],
      }),
    );
    expect(chapters.some((c) => c.title === long)).toBe(false);
  });
});

describe('detectChapters - corroboration and fallbacks', () => {
  it('prefers the outline page when the marker page is more than 2 off', async () => {
    const chapters = await detectChapters(
      baseInput({
        pageCount: 60,
        items: [
          heading(2, 'Chapter 1. Start', 2),
          heading(2, 'Chapter 2. Middle', 20),
        ],
        outline: [
          { title: 'Chapter 1. Start', page: 2, children: [] },
          { title: 'Chapter 2. Middle', page: 31, children: [] },
        ],
      }),
    );
    expect(chapters[1].startPage).toBe(31);
  });

  it('keeps the marker page when the outline is within 2', async () => {
    const chapters = await detectChapters(
      baseInput({
        pageCount: 60,
        items: [
          heading(2, 'Chapter 1. Start', 2),
          heading(2, 'Chapter 2. Middle', 20),
        ],
        outline: [
          { title: 'Chapter 1. Start', page: 2, children: [] },
          { title: 'Chapter 2. Middle', page: 21, children: [] },
        ],
      }),
    );
    expect(chapters[1].startPage).toBe(20);
  });

  it('falls back to the largest same-level heading cluster', async () => {
    const chapters = await detectChapters(
      baseInput({
        pageCount: 40,
        items: [
          heading(1, 'Book Title', 1),
          heading(2, 'Movement One', 3),
          heading(2, 'Movement Two', 15),
          heading(2, 'Movement Three', 28),
          heading(4, 'a footnote', 9),
        ],
      }),
    );
    expect(chapters.map((c) => c.title)).toEqual([
      'Movement One',
      'Movement Two',
      'Movement Three',
    ]);
  });

  it('uses resolveGapTitle for a synthesised gap the outline cannot name', async () => {
    const chapters = await detectChapters(
      baseInput({
        pageCount: 30,
        items: [
          heading(2, 'Chapter 2. Two', 5),
          heading(2, 'Chapter 3. Three', 18),
        ],
      }),
      { resolveGapTitle: () => Promise.resolve('The Missing First') },
    );
    expect(chapters[0].title).toBe('The Missing First');
  });
});
