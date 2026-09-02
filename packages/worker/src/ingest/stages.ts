import type { Stage } from './stage.js';
import { extractStage } from './stages/extract.stage.js';
import { identifyBookStage } from './stages/identify-book.stage.js';
import { chunkStage } from './stages/chunk.stage.js';
import { embedStage } from './stages/embed.stage.js';
import { chapterSummaryStage } from './stages/chapter-summary.stage.js';
import { bookSummaryStage } from './stages/book-summary.stage.js';

/**
 * The fixed pipeline. The processor walks this list from the top on every job
 * start; nothing branches on stored state to choose the next stage. After the
 * last stage the processor finalizes the book to `ready`.
 *
 * `chapterSummary` precedes `bookSummary`: the whole-book summary is the reduce
 * over the per-chapter deep dives (chapter-detection & book-summary strategy
 * spec, section 2.5).
 */
export const STAGES: readonly Stage[] = [
  extractStage,
  identifyBookStage,
  chunkStage,
  embedStage,
  chapterSummaryStage,
  bookSummaryStage,
];
