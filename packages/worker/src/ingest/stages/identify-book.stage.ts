import { withRetry } from '../retry.js';
import { errorMessage } from '../errors.js';
import type { Stage } from '../stage.js';

// The identify call sees only the opening of the book. ~2 printed pages of
// markdown is plenty for a title page + copyright page + first heading.
const IDENTIFY_CHAR_BUDGET = 4_000;

const IDENTIFY_SYSTEM = [
  'You identify a book from the opening pages of its text.',
  'Respond with a single minified JSON object and nothing else:',
  '{"title": string, "author": string | null}.',
  'Use null for author if the pages do not name one. Do not guess wildly.',
].join(' ');

interface Identity {
  title: string | null;
  author: string | null;
}

function parseIdentity(raw: string): Identity {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { title: null, author: null };
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const title =
      typeof parsed.title === 'string' && parsed.title.trim().length > 0
        ? parsed.title.trim()
        : null;
    const author =
      typeof parsed.author === 'string' && parsed.author.trim().length > 0
        ? parsed.author.trim()
        : null;
    return { title, author };
  } catch {
    return { title: null, author: null };
  }
}

/**
 * Stage 2. One cheap LLM call over the opening pages to backfill
 * `{ title, author }`. Runs under `extracting` (no new status). Skipped when a
 * title already exists (a user override on `POST /books`, or a prior run).
 * Failure is non-fatal: it is logged and the pipeline continues on the
 * filename.
 */
export const identifyBookStage: Stage = {
  name: 'identifyBook',
  enterStatus: null,

  isComplete(book): Promise<boolean> {
    return Promise.resolve(book.title != null);
  },

  async run(book, { storage, llm, repo, events, logger }): Promise<void> {
    try {
      if (!book.extractedMarkdownKey) {
        throw new Error('extract stage has not stored markdown yet');
      }
      const bytes = await storage.getObject(book.extractedMarkdownKey);
      if (!bytes) throw new Error('extracted markdown blob is missing');

      const opening = Buffer.from(bytes)
        .toString('utf-8')
        .slice(0, IDENTIFY_CHAR_BUDGET);

      const raw = await withRetry(() =>
        llm.complete({
          system: IDENTIFY_SYSTEM,
          messages: [{ role: 'user', content: opening }],
          maxTokens: 200,
        }),
      );

      const { title, author } = parseIdentity(raw);
      if (!title) {
        logger.warn(
          `identifyBook: no title parsed for book ${book.id}, keeping filename`,
        );
        return;
      }

      // Only announce the identification if it actually landed - a concurrent
      // user PATCH could have set an authoritative title in the meantime, and
      // `recordIdentification` will not overwrite it.
      const written = await repo.recordIdentification(book.id, {
        title,
        author,
      });
      if (written) await events.bookIdentified(book.id, title, author);
    } catch (error) {
      logger.warn(
        `identifyBook failed for book ${book.id}, continuing: ${errorMessage(
          error,
        )}`,
      );
    }
  },
};
