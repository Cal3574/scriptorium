import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AgentEvent } from '@scriptorium/contracts';
import {
  LLM_CLIENT,
  type LlmClient,
  type LlmMessage,
} from '@scriptorium/providers';
import { AgentRepository } from '@scriptorium/server-core';
import {
  AGENT_MAX_TOKENS,
  AGENT_SYSTEM_PROMPT,
  buildAgentUserMessage,
} from './agent-prompt.js';
import { maybeTrimThread } from './context-window.js';
import { buildPromptHistory } from './thread-history.js';

export interface RunAgentTurnParams {
  userId: string;
  // Already ownership-checked by the controller.
  bookId: string;
  message: string;
  // The highlight-to-discuss seed, or null for a plain follow-up.
  highlightedPassage: string | null;
}

/**
 * One turn of a reading-companion conversation, behind
 * `POST /api/v1/books/:bookId/agent-messages`. A request-scoped streaming
 * operation - no BullMQ job, no worker, and no retrieval: the model sees only
 * the highlighted passage and this thread's own history.
 *
 * Durability is ordered deliberately. The thread is found-or-created and the
 * reader's message is written *before* `agent_turn_started` is yielded, so the
 * reader's words survive any failure from that point on. The assistant row is
 * written only once the stream has completed, so a mid-generation failure
 * leaves the turn visibly unanswered rather than silently half-written -
 * exactly the shape {@link reassembleHistory} skips on the next turn.
 *
 * Every failure after the first yield is an `agent_error` event, never an HTTP
 * status: the stream is already open by then. A client disconnect aborts
 * `signal` and unwinds without writing an assistant row.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    private readonly agent: AgentRepository,
  ) {}

  async *run(
    params: RunAgentTurnParams,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const thread = await this.agent.findOrCreateThread(
      params.userId,
      params.bookId,
    );

    // Read history *before* inserting the new user message so the live turn is
    // not also replayed as history.
    const history = buildPromptHistory(
      thread,
      await this.agent.listMessages(thread.id),
    );

    const userMessageId = await this.agent.insertMessage({
      threadId: thread.id,
      role: 'user',
      message: params.message,
      highlightedPassage: params.highlightedPassage,
    });
    yield {
      type: 'agent_turn_started',
      threadId: thread.id,
      userMessageId,
    };

    let reply: string;
    try {
      reply = yield* this.streamReply(history, params, signal);
    } catch (error) {
      if (signal?.aborted) return; // clean disconnect - not an error
      this.logger.error(
        `agent turn on thread ${thread.id} failed after the stream opened`,
        error instanceof Error ? error.stack : String(error),
      );
      yield {
        type: 'agent_error',
        message: 'The reply could not be generated. Try again in a moment.',
      };
      return;
    }

    if (signal?.aborted) return;

    const messageId = await this.agent.insertMessage({
      threadId: thread.id,
      role: 'assistant',
      message: reply,
    });
    await this.agent.touchThread(thread.id);
    yield { type: 'agent_done', messageId, message: reply };

    // Deliberately after the last yield: by the time the SSE pump resumes this
    // generator to find out it's done, the `agent_done` frame has already been
    // handed to the client - trimming the thread here never delays the reply
    // the reader is waiting on. See `maybeTrimThread` (#158). Swallowed on
    // failure: the turn itself already succeeded and the client has moved on,
    // so a broken summarization call must not surface as a failed turn - the
    // thread just stays untrimmed until a later turn tries again.
    try {
      await maybeTrimThread(this.llm, this.agent, thread, signal);
    } catch (error) {
      this.logger.error(
        `context-window trim for thread ${thread.id} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // Streams the companion's reply as `agent_text_delta` events and returns the
  // full concatenated text.
  private async *streamReply(
    history: LlmMessage[],
    params: RunAgentTurnParams,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<AgentEvent, string> {
    const userMessage = buildAgentUserMessage(
      params.message,
      params.highlightedPassage,
    );

    let reply = '';
    for await (const delta of this.llm.stream(
      {
        system: AGENT_SYSTEM_PROMPT,
        messages: [...history, { role: 'user', content: userMessage }],
        maxTokens: AGENT_MAX_TOKENS,
      },
      signal,
    )) {
      reply += delta;
      yield { type: 'agent_text_delta', text: delta };
    }
    return reply;
  }
}
