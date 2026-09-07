// THROWAWAY - step 2: run chapter detection over the cached parse, eyeball it.
import { readCache, detectChapters } from './lib.mjs';

const parse = readCache('parse.json');
if (!parse) throw new Error('run `node 1-parse.mjs` first');

// hand-keyed ground truth for The Pragmatic Programmer, 1st ed (1999)
const GROUND_TRUTH = [
  'Preface (front matter)',
  'Chapter 1. A Pragmatic Philosophy',
  'Chapter 2. A Pragmatic Approach',
  'Chapter 3. The Basic Tools',
  'Chapter 4. Pragmatic Paranoia',
  'Chapter 5. Bend, or Break',
  'Chapter 6. While You Are Coding',
  'Chapter 7. Before the Project',
  'Chapter 8. Pragmatic Projects',
  'Appendix A. Resources',
  'Appendix B. Answers to Exercises',
];

const { pageCount, tocPages, markers, gaps, frontMatterHeadings } = detectChapters(parse);

console.log(`\nPDF pages: ${pageCount}   detected TOC pages: [${tocPages.join(', ')}]`);
console.log(`front-matter headings before first chapter: ${frontMatterHeadings.map((h) => h.text).join(' | ') || '(none)'}`);

console.log('\n=== detected chapter markers ===');
for (const m of markers) {
  console.log(
    `  ${(m.kind + ' ' + m.num).padEnd(11)} p${String(m.startPage).padStart(3)}-${String(m.endPage).padStart(3)}  ${m.title}   (${m.blockType})`,
  );
}

console.log(`\ngaps in chapter numbering: ${gaps.length ? gaps.join(', ') : '(none)'}`);
if (gaps.length) {
  console.log(
    '  -> pipeline would synthesise a chapter for each gap, spanning from the end of\n' +
      '     front matter (or the previous marker) to the next detected marker.',
  );
}

console.log('\n=== vs ground truth ===');
console.log(`ground truth: ${GROUND_TRUTH.length - 1} chapters + preface`);
console.log(`detected:     ${markers.length} markers  (${markers.length === GROUND_TRUTH.length - 1 ? 'MATCH' : 'MISMATCH - see gaps above'})`);
