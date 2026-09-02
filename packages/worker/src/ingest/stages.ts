import type { Stage } from './stage.js';
import { extractStage } from './stages/extract.stage.js';
import { identifyBookStage } from './stages/identify-book.stage.js';
import { chunkStage } from './stages/chunk.stage.js';

/**
 * The fixed pipeline. The processor walks this list from the top on every job
 * start; nothing branches on stored state to choose the next stage. Later
 * tickets slot `embed`, `chapterSummary`, `bookSummary` and a `finalize`
 * (status -> `ready`) in after `chunk`.
 */
export const STAGES: readonly Stage[] = [
  extractStage,
  identifyBookStage,
  chunkStage,
];
