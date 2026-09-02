import { withRetry } from '../retry.js';
import { TerminalIngestError } from '../errors.js';
import type { Stage } from '../stage.js';
import { BOOK_SUMMARY_SYSTEM, SUMMARY_MAX_TOKENS } from './summary-prompts.js';

/**
 * Stage 6. The whole-book summary is the reduce over the per-chapter deep
 * dives: a single Claude call over the concatenation of the chapter summaries,
 * each prefixed `## <chapter title>`. Writes `books.summary` and
 * `summary_generated_at`. Runs only once every chapter summary is set, and is
 * complete once `books.summary` is set.
 */
export const bookSummaryStage: Stage = {
  name: 'bookSummary',
  enterStatus: 'summarizing',

  async isComplete(book, { repo }): Promise<boolean> {
    if (book.summary == null) return false;
    const total = await repo.countChapters(book.id);
    if (total === 0) return false;
    return (await repo.countChaptersMissingSummary(book.id)) === 0;
  },

  async run(book, { repo, llm, logger }): Promise<void> {
    const chapters = await repo.listChapterSummaries(book.id);
    if (chapters.length === 0) {
      throw new TerminalIngestError(
        `bookSummary ran with no chapter summaries for book ${book.id}`,
      );
    }

    const reduceInput = chapters
      .map((c, i) => `## ${c.title ?? `Chapter ${i + 1}`}\n\n${c.summary}`)
      .join('\n\n');

    const summary = await withRetry(() =>
      llm.complete({
        system: BOOK_SUMMARY_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Here are per-chapter summaries of a book. Write the whole-book summary.\n\n${reduceInput}`,
          },
        ],
        maxTokens: SUMMARY_MAX_TOKENS,
      }),
    );

    await repo.writeBookSummary(book.id, summary);
    logger.log(`bookSummary: wrote whole-book summary for book ${book.id}`);
  },
};
