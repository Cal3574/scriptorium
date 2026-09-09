// The eleven stops of the journey, in fixed order (#83). Two acts read as one
// continuous scroll: stops 1-7 turn a book into a summary, stops 8-11 turn a
// question into a cited answer. Copy is concept-only on purpose - no vendor,
// model, or infrastructure names - so the page stays correct when the
// internals change. Each stop is one heading plus two or three short
// sentences, in the app's plain second-person voice.

export type Act = 'reading' | 'asking';

export type Stop = {
  /** Stable key, also the DOM id of the panel. */
  id: string;
  act: Act;
  heading: string;
  body: string;
};

export const STOPS: Stop[] = [
  {
    id: 'upload',
    act: 'reading',
    heading: 'You start with a book',
    body: 'You add a book by uploading its PDF. That is the only thing the process needs from you. Everything after this happens on its own.',
  },
  {
    id: 'text',
    act: 'reading',
    heading: 'The pages become plain text',
    body: 'Every page is read and turned into clean, plain text, in reading order. Nothing is skimmed or sampled: the whole book goes in, front to back.',
  },
  {
    id: 'chapters',
    act: 'reading',
    heading: 'The chapters are found',
    body: 'The text is scanned for where each chapter begins and ends. This is why your summary is organised the way the book is, one chapter at a time.',
  },
  {
    id: 'passages',
    act: 'reading',
    heading: 'Each chapter is cut into short passages',
    body: 'Every chapter is broken into short passages, each a few paragraphs long. The passages overlap at their edges, so an idea that runs across a break is never split in half.',
  },
  {
    id: 'meaning-space',
    act: 'reading',
    heading: 'Every passage is placed in a meaning space',
    body: 'Each passage is turned into a list of numbers that captures what it is about, then placed as a point in a shared space where passages about similar things sit close together. Points are tinted by which book they came from. It is drawn flat here, but the real space has many more directions than a page can show.',
  },
  {
    id: 'chapter-summaries',
    act: 'reading',
    heading: 'Each chapter gets a close reading',
    body: 'A summary is written for every chapter on its own, working only from the passages in that chapter. Because each one is read closely and in isolation, the detail holds up.',
  },
  {
    id: 'book-summary',
    act: 'reading',
    heading: 'The chapter summaries become one',
    body: 'The chapter summaries are combined into a single summary of the whole book. It is a synthesis of the close readings, not a separate quick pass over the text. Your book is now ready.',
  },
  {
    id: 'ask',
    act: 'asking',
    heading: 'You ask across your whole library',
    body: 'When you have a question, you ask it once and it runs across every book you have added, not one book at a time. Comparisons between books work because every book is in scope by default.',
  },
  {
    id: 'retrieve',
    act: 'asking',
    heading: 'Your question is placed in the same space',
    body: 'Your question is turned into a point in the same meaning space as the passages. The passages sitting nearest to it are gathered as candidates, so a match is about meaning, not shared words.',
  },
  {
    id: 'rerank',
    act: 'asking',
    heading: 'The strongest few are kept',
    body: 'Only the closest handful of passages are kept, and they are balanced so no single book crowds out the rest. This is why a question that spans several books draws on several books.',
  },
  {
    id: 'answer',
    act: 'asking',
    heading: 'The answer is drafted from those passages',
    body: 'The answer is written using only the passages that were kept. Each claim carries a citation you can open to read the passage it came from, so nothing in the answer is unsourced or invented. When the passages do not cover your question, it says so rather than guessing.',
  },
];

export const HERO = {
  title: 'How Scriptorium works',
  promise:
    'The path a book takes from the file you upload to an answer you can check, one step at a time.',
  scrollCue: 'Scroll to follow a book through',
};

export const RECAP = {
  shortVersion:
    'The short version: you upload a book as a PDF. It is read in full, split into chapters and then into short overlapping passages, and every passage is placed in a shared meaning space. Each chapter is summarised closely, and the chapter summaries are combined into one. When you ask a question, it is placed in that same space, the nearest passages across all your books are gathered and narrowed to the strongest few, and an answer is drafted from those passages alone.',
  trustLine:
    'Every answer is built only from passages in your own books, and it shows you which ones.',
  ctaLabel: 'Add a book',
  ctaTo: '/library',
};

export const MEANING_SPACE_CAVEAT =
  'Shown flat here. The real meaning space has many more directions than a page can draw.';
