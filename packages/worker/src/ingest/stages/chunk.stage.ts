import { setImmediate } from 'node:timers/promises';
import type { LlmClient } from '@scriptorium/providers';
import type { ChapterInput } from '@scriptorium/server-core';
import { TerminalIngestError } from '../errors.js';
import type { Stage } from '../stage.js';
import {
  detectChapters,
  pageRangeMarkdown,
  type DetectedChapter,
} from '../chapter-detection/detect-chapters.js';
import { chunkText } from '../chunking/chunk-text.js';
import { countTokens } from '../chunking/token-count.js';
import {
  extractionArtifactKey,
  loadExtractionArtifact,
} from './extraction-artifact.js';

// The identify-book stage's JSON contract is reused here for the cheap
// gap-title call: one heading, minified JSON back.
const GAP_TITLE_SYSTEM = [
  'You name a single book chapter from its opening text.',
  'Respond with one minified JSON object and nothing else:',
  '{"title": string}. Keep it under 60 characters. No chapter number.',
].join(' ');

const GAP_TITLE_CHAR_BUDGET = 2_000;

/**
 * Stage 3. Turn the extracted book into ordered chapters and paragraph-aligned
 * chunks: run chapter detection over the extraction sidecar, then slice
 * ~600-token / ~80-overlap chunks per chapter and write chapters + chunks in
 * one transaction (`embedding` left null for the embed stage). Complete once
 * `chapters` rows exist for the book.
 */
export const chunkStage: Stage = {
  name: 'chunk',
  enterStatus: 'chunking',

  isComplete(book, { repo }): Promise<boolean> {
    return repo.hasChapters(book.id);
  },

  async run(book, { storage, llm, repo, logger }): Promise<void> {
    const artifact = await loadExtractionArtifact(
      storage,
      extractionArtifactKey(book),
    );
    if (!artifact) {
      throw new TerminalIngestError(
        `extraction sidecar is missing for book ${book.id}`,
      );
    }

    const chapters = await detectChapters(
      {
        pages: artifact.pages,
        items: artifact.items,
        outline: artifact.outline,
        metadata: artifact.metadata,
        pageCount: artifact.pageCount,
      },
      { resolveGapTitle: (ctx) => resolveGapTitle(llm, ctx) },
    );
    logger.log(
      `chunk: detected ${chapters.length} chapters for book ${book.id}`,
    );

    const bookTitle = book.title ?? book.originalFilename;
    const payloads: ChapterInput[] = [];

    for (const chapter of chapters) {
      const text = pageRangeMarkdown(
        artifact.pages,
        chapter.startPage,
        chapter.endPage,
      );
      const slices = chunkText(text, { countTokens });
      const chapterTitle = displayTitle(chapter);
      payloads.push({
        chapterIndex: chapter.chapterIndex,
        title: chapter.title,
        pageStart: chapter.startPage,
        pageEnd: chapter.endPage,
        chunkRowChapterTitle: chapterTitle,
        chunks: slices.map((slice) => ({
          chunkText: slice.text,
          tokenCount: slice.tokenCount,
          pageStart: chapter.startPage,
          pageEnd: chapter.endPage,
        })),
      });
      // Yield between chapters so a large book does not monopolise the worker.
      await setImmediate();
    }

    await repo.writeChaptersAndChunks({
      bookId: book.id,
      userId: book.userId,
      bookTitle,
      chapters: payloads,
    });
  },
};

function displayTitle(chapter: DetectedChapter): string {
  return chapter.title ?? `Chapter ${chapter.chapterIndex + 1}`;
}

async function resolveGapTitle(
  llm: LlmClient,
  ctx: { chapterNumber: number; text: string },
): Promise<string | null> {
  if (ctx.text.trim().length === 0) return null;
  try {
    const raw = await llm.complete({
      system: GAP_TITLE_SYSTEM,
      messages: [
        { role: 'user', content: ctx.text.slice(0, GAP_TITLE_CHAR_BUDGET) },
      ],
      maxTokens: 60,
    });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { title?: unknown };
    return typeof parsed.title === 'string' && parsed.title.trim().length > 0
      ? parsed.title.trim().slice(0, 60)
      : null;
  } catch {
    return null;
  }
}
