import { EMBEDDING_DIMENSIONS } from '@scriptorium/providers';
import { TerminalIngestError } from '../errors.js';
import { withRetry } from '../retry.js';
import { batch, mapWithConcurrency } from '../concurrency.js';
import type { Stage } from '../stage.js';

// Verbatim from the ingest-job spec section 5. A ~600-token chunk batched 128
// at a time is ~77k tokens per request, well under OpenAI's 300k-token /
// 2048-input caps; a failed batch loses at most 128 chunks of work.
const BATCH_SIZE = 128;
const BATCH_CONCURRENCY = 2;

/**
 * Stage 4. Embed every chunk with `embedding is null` via the embedding client,
 * `chunk_index` order, in batches of {@link BATCH_SIZE} with
 * {@link BATCH_CONCURRENCY} batches in flight. Each batch is written back in one
 * transaction, so it flips to "done" atomically and a crash resumes from the
 * next null. Complete once the book has at least one chunk and none unembedded.
 */
export const embedStage: Stage = {
  name: 'embed',
  enterStatus: 'embedding',

  async isComplete(book, { repo }): Promise<boolean> {
    const { total, unembedded } = await repo.chunkEmbeddingCounts(book.id);
    return total > 0 && unembedded === 0;
  },

  async run(book, { repo, embeddings, events, logger }): Promise<void> {
    const pending = await repo.listUnembeddedChunks(book.id);
    if (pending.length === 0) return;

    const { total } = await repo.chunkEmbeddingCounts(book.id);
    let done = total - pending.length;
    const batches = batch(pending, BATCH_SIZE);
    logger.log(
      `embed: ${pending.length} chunks in ${batches.length} batches for book ${book.id}`,
    );

    await mapWithConcurrency(batches, BATCH_CONCURRENCY, async (rows) => {
      const vectors = await withRetry(() =>
        embeddings.embed(rows.map((r) => r.text)),
      );
      if (vectors.length !== rows.length) {
        throw new TerminalIngestError(
          `embedding client returned ${vectors.length} vectors for ${rows.length} chunks`,
        );
      }
      for (const vector of vectors) {
        if (vector.length !== EMBEDDING_DIMENSIONS) {
          throw new TerminalIngestError(
            `embedding client returned a ${vector.length}-d vector, expected ${EMBEDDING_DIMENSIONS}`,
          );
        }
      }

      await repo.writeChunkEmbeddings(
        rows.map((row, i) => ({ id: row.id, embedding: vectors[i] })),
      );

      done += rows.length;
      await events.stageProgress(book.id, 'embedding', {
        done,
        total,
        unit: 'chunks',
      });
    });
  },
};
