import {
  parseSentinelPages,
  parseSentinelPagesLenient,
  SentinelMismatchError,
} from './parse-sentinel-pages.js';

describe('parseSentinelPages', () => {
  it('splits a batch response into per-page markdown, mapped to absolute pages', () => {
    const response = [
      '<!-- page 1 -->',
      '# Chapter 3',
      '',
      'The opening line.',
      '<!-- page 2 -->',
      'Second page body.',
      '<!-- page 3 -->',
      '## A sub-heading',
      'Third page.',
    ].join('\n');

    expect(parseSentinelPages(response, [11, 12, 13])).toEqual([
      { page: 11, markdown: '# Chapter 3\n\nThe opening line.' },
      { page: 12, markdown: 'Second page body.' },
      { page: 13, markdown: '## A sub-heading\nThird page.' },
    ]);
  });

  it('discards any preamble before the first sentinel', () => {
    const response = [
      'Here is the transcription:',
      '',
      '<!-- page 1 -->',
      'Body.',
    ].join('\n');
    expect(parseSentinelPages(response, [5])).toEqual([
      { page: 5, markdown: 'Body.' },
    ]);
  });

  it('tolerates whitespace and case in the sentinel', () => {
    const response = '  <!--  Page   1  -->  \nBody.';
    expect(parseSentinelPages(response, [9])).toEqual([
      { page: 9, markdown: 'Body.' },
    ]);
  });

  it('ignores the folio printed on the page and numbers by slice position', () => {
    // The model was sent a 3-page extract of pages 161-163, printed "153"-"155".
    const response =
      '<!-- page 1 -->\nA\n<!-- page 2 -->\nB\n<!-- page 3 -->\nC';
    expect(parseSentinelPages(response, [161, 162, 163])).toEqual([
      { page: 161, markdown: 'A' },
      { page: 162, markdown: 'B' },
      { page: 163, markdown: 'C' },
    ]);
  });

  it('throws when a page is missing', () => {
    const response = '<!-- page 1 -->\nA\n<!-- page 3 -->\nC';
    expect(() => parseSentinelPages(response, [1, 2, 3])).toThrow(
      SentinelMismatchError,
    );
  });

  it('throws when pages are out of order', () => {
    const response = '<!-- page 2 -->\nB\n<!-- page 1 -->\nA';
    expect(() => parseSentinelPages(response, [1, 2])).toThrow(/out of order/);
  });

  it('throws when the model emits a sentinel past the end of the slice', () => {
    const response = '<!-- page 1 -->\nA\n<!-- page 2 -->\nB';
    expect(() => parseSentinelPages(response, [1])).toThrow(
      SentinelMismatchError,
    );
  });
});

describe('parseSentinelPagesLenient', () => {
  it('returns the pages it got and the ones it did not, for a dropped tail', () => {
    const response = '<!-- page 1 -->\nA\n<!-- page 2 -->\nB';
    expect(parseSentinelPagesLenient(response, [5, 6, 7, 8])).toEqual({
      pages: [
        { page: 5, markdown: 'A' },
        { page: 6, markdown: 'B' },
      ],
      missing: [7, 8],
    });
  });

  it('reports a dropped middle page', () => {
    const response = '<!-- page 1 -->\nA\n<!-- page 3 -->\nC';
    expect(parseSentinelPagesLenient(response, [40, 41, 42])).toEqual({
      pages: [
        { page: 40, markdown: 'A' },
        { page: 42, markdown: 'C' },
      ],
      missing: [41],
    });
  });

  it('still throws on an out-of-order or out-of-range sentinel', () => {
    expect(() =>
      parseSentinelPagesLenient(
        '<!-- page 2 -->\nB\n<!-- page 1 -->\nA',
        [1, 2],
      ),
    ).toThrow(SentinelMismatchError);
    expect(() =>
      parseSentinelPagesLenient('<!-- page 9 -->\nX', [1, 2]),
    ).toThrow(SentinelMismatchError);
  });
});
