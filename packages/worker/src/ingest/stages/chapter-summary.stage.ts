import { withRetry } from '../retry.js';
import { mapWithConcurrency } from '../concurrency.js';
import { pageRangeMarkdown } from '../chapter-detection/detect-chapters.js';
import { TerminalIngestError } from '../errors.js';
import type { Stage } from '../stage.js';
import {
  extractionArtifactKey,
  loadExtractionArtifact,
} from './extraction-artifact.js';
import {
  CHAPTER_SUMMARY_SYSTEM,
  SUMMARY_MAX_TOKENS,
} from './summary-prompts.js';

// Spec 2.3: three chapter deep-dives in flight.
const CHAPTER_CONCURRENCY = 3;

/**
 * Stage 5. One Claude deep-dive per chapter with `summary is null`,
 * `chapter_index` order, concurrency {@link CHAPTER_CONCURRENCY}, written back
 * per chapter so a crash resumes on the chapters still missing a summary. The
 * chapter's raw markdown is sliced from the extraction sidecar by page range
 * (chunks are RAG-only; the deep-dive reads whole-chapter prose). A chapter
 * that fails all in-stage retries throws, and the book lands `failed`.
 */
export const chapterSummaryStage: Stage = {
  name: 'chapterSummary',
  enterStatus: 'summarizing',

  async isComplete(book, { repo }): Promise<boolean> {
    const total = await repo.countChapters(book.id);
    if (total === 0) return false;
    return (await repo.countChaptersMissingSummary(book.id)) === 0;
  },

  async run(book, { repo, llm, storage, events, logger }): Promise<void> {
    const pending = await repo.listChaptersMissingSummary(book.id);
    if (pending.length === 0) return;

    const artifact = await loadExtractionArtifact(
      storage,
      extractionArtifactKey(book),
    );
    if (!artifact) {
      throw new TerminalIngestError(
        `extraction sidecar is missing for book ${book.id}`,
      );
    }

    const total = await repo.countChapters(book.id);
    let done = total - pending.length;
    logger.log(
      `chapterSummary: ${pending.length} chapters for book ${book.id}`,
    );

    await mapWithConcurrency(pending, CHAPTER_CONCURRENCY, async (chapter) => {
      const title = chapter.title ?? `Chapter ${chapter.chapterIndex + 1}`;
      const start = chapter.pageStart ?? 1;
      const end = chapter.pageEnd ?? artifact.pageCount;
      const body = pageRangeMarkdown(artifact.pages, start, end);

      const summary = await withRetry(() =>
        llm.complete({
          system: CHAPTER_SUMMARY_SYSTEM,
          messages: [
            {
              role: 'user',
              content: `Chapter: ${title}\n\n${body || '(no text extracted for this chapter)'}`,
            },
          ],
          maxTokens: SUMMARY_MAX_TOKENS,
        }),
      );

      await repo.writeChapterSummary(chapter.id, summary);
      done += 1;
      await events.stageProgress(book.id, 'summarizing', {
        done,
        total,
        unit: 'chapters',
      });
    });
  },
};
