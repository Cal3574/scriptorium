import { deriveHeadings } from '../derive-headings.js';
import { parseSentinelPages } from '../parse-sentinel-pages.js';
import { RECORDED_BATCH_RESPONSE } from './recorded-batch-response.js';

// Replay a captured real Gemini batch response through the parser and heading
// assembler, so a change to either that would misread the real wire shape
// fails here rather than in production.
describe('recorded Gemini batch response', () => {
  const pages = parseSentinelPages(RECORDED_BATCH_RESPONSE, [40, 41, 42]);

  it('splits into the three expected pages', () => {
    expect(pages.map((p) => p.page)).toEqual([40, 41, 42]);
  });

  it('keeps the page body without the sentinel or leading blank line', () => {
    expect(pages[0].markdown.startsWith('the dependency graph.')).toBe(true);
    expect(pages[0].markdown).toContain('## 3.4 Coupling and Cohesion');
    expect(pages[0].markdown).toContain('[^1]: Parnas');
  });

  it('derives the mid-page headings with the right page numbers', () => {
    expect(deriveHeadings(pages)).toEqual([
      {
        type: 'heading',
        level: 2,
        text: '3.4 Coupling and Cohesion',
        page: 40,
      },
      { type: 'heading', level: 3, text: 'Exercises', page: 42 },
    ]);
  });
});
