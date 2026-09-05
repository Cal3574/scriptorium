import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  Citation,
  PersistedCitation,
  QueryEvent,
} from '@scriptorium/contracts';
import {
  EMBEDDING_CLIENT,
  type EmbeddingClient,
  LLM_CLIENT,
  type LlmClient,
} from '@scriptorium/providers';
import { QueriesRepository } from '@scriptorium/server-core';
import { auditCitations } from './citation-parser.js';
import { QuestionEmbeddingFailedException } from './queries.problems.js';
import { RAG_CONFIG, type RagConfig } from './queries.tokens.js';
import { type Candidate, selectChunks } from './select-chunks.js';
import {
  buildUserMessage,
  SYNTHESIS_MAX_TOKENS,
  SYSTEM_PROMPT,
} from './synthesis-prompt.js';

// The standing "not enough context" answer, used when retrieval returns
// nothing at all (no excerpt block to synthesise from - the paid call is
// skipped). rag-query-spec 3.4.
const NOT_ENOUGH_CONTEXT = 'The library does not seem to cover this.';

export interface RunQueryParams {
  userId: string;
  question: string;
  // Null for a cross-book query; already ownership-checked by the controller.
  bookId: string | null;
}

/**
 * The retrieval + synthesis pipeline behind `POST /api/v1/queries`. A
 * request-scoped, streaming operation - no BullMQ job, no worker. The `queries`
 * row is the only persistence: inserted `answer = null` at `query_started`,
 * updated once at `done`. On an `error` mid-stream, or a client disconnect (the
 * consumer stops pulling and calls `.return()`, which also aborts `signal`),
 * the row is left `answer = null`.
 *
 * A question-embedding failure throws {@link QuestionEmbeddingFailedException}
 * from the first `next()`, before any row or event - the controller renders it
 * as a `502` problem+json since the stream has not opened. Any failure *after*
 * `query_started` (retrieval, the DB, synthesis) is an `error` event instead,
 * because the stream is already open.
 */
@Injectable()
export class QueryService {
  private readonly logger = new Logger(QueryService.name);

  constructor(
    @Inject(EMBEDDING_CLIENT) private readonly embeddings: EmbeddingClient,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    private readonly queries: QueriesRepository,
    @Inject(RAG_CONFIG) private readonly config: RagConfig,
  ) {}

  async *run(
    params: RunQueryParams,
    signal?: AbortSignal,
  ): AsyncGenerator<QueryEvent> {
    const embedding = await this.embedQuestion(params.question);

    const id = await this.queries.insertPending({
      userId: params.userId,
      question: params.question,
      bookId: params.bookId,
    });
    yield { type: 'query_started', id };

    try {
      yield* this.answer(id, params, embedding, signal);
    } catch (error) {
      if (signal?.aborted) return; // clean disconnect - not an error
      this.logger.error(
        `query ${id} failed after the stream opened`,
        error instanceof Error ? error.stack : String(error),
      );
      yield {
        type: 'error',
        message: 'The answer could not be generated. Try again in a moment.',
      };
    }
  }

  private async *answer(
    id: string,
    params: RunQueryParams,
    embedding: number[],
    signal: AbortSignal | undefined,
  ): AsyncGenerator<QueryEvent> {
    const candidates = await this.queries.retrieveCandidates({
      userId: params.userId,
      bookId: params.bookId,
      queryEmbedding: embedding,
      efSearch: this.config.efSearch,
      poolLimit: this.config.poolLimit,
    });
    const { selected, lowConfidence } = selectChunks(candidates, this.config);
    const citations = toCitations(selected);
    yield { type: 'citations', citations };

    const answer =
      selected.length === 0
        ? NOT_ENOUGH_CONTEXT
        : yield* this.streamSynthesis(
            params.question,
            selected,
            lowConfidence,
            signal,
          );

    // Citation enforcement is prompt + post-parse only: audit and log which
    // markers the answer used, never rewrite or reject.
    const used = auditCitations(answer, selected.length);
    this.logger.log(
      `query ${id}: ${selected.length} retrieved, cited [${used.cited.join(
        ',',
      )}]${used.dropped.length ? ` dropped [${used.dropped.join(',')}]` : ''}`,
    );

    await this.queries.complete(id, {
      answer,
      citations: toPersistedCitations(citations),
    });
    yield { type: 'done', answer };
  }

  // Streams the synthesis deltas as `text_delta` events and returns the full
  // concatenated answer.
  private async *streamSynthesis(
    question: string,
    selected: Candidate[],
    lowConfidence: boolean,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<QueryEvent, string> {
    const userMessage = buildUserMessage(question, selected, lowConfidence);
    let answer = '';
    for await (const delta of this.llm.stream(
      {
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: SYNTHESIS_MAX_TOKENS,
      },
      signal,
    )) {
      answer += delta;
      yield { type: 'text_delta', text: delta };
    }
    return answer;
  }

  private async embedQuestion(question: string): Promise<number[]> {
    let vectors: number[][];
    try {
      vectors = await this.embeddings.embed([question]);
    } catch {
      throw new QuestionEmbeddingFailedException();
    }
    const [vector] = vectors;
    if (!vector) throw new QuestionEmbeddingFailedException();
    return vector;
  }
}

// The `citations` event carries every selected chunk in `[n]` order, full
// `Citation` shape - the answer's `[n]` markers point into this list.
function toCitations(selected: Candidate[]): Citation[] {
  return selected.map((chunk, index) => ({
    marker: index + 1,
    chunkId: chunk.chunkId,
    bookId: chunk.bookId,
    bookTitle: chunk.bookTitle,
    chapterTitle: chunk.chapterTitle,
    chunkText: chunk.chunkText,
  }));
}

// What is frozen into `queries.citations`: the same array minus `bookId` and
// `marker` (`marker` is re-derivable from order; `bookId` is dropped so a
// history entry never dangles against a deleted book).
function toPersistedCitations(citations: Citation[]): PersistedCitation[] {
  return citations.map((c) => ({
    chunkId: c.chunkId,
    bookTitle: c.bookTitle,
    chapterTitle: c.chapterTitle,
    chunkText: c.chunkText,
  }));
}
