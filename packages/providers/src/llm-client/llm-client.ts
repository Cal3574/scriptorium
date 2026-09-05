// The seam between the pipeline / RAG query path and a chat LLM. Used for three
// jobs: the whole-book summary, per-chapter deep dives, and streaming query
// synthesis. The live adapter drives Claude (`claude-sonnet-5`); the fake
// returns templated markdown. `complete` is the one-shot form (book / chapter
// summaries, the identify-book call); `stream` is the synthesis form the query
// endpoint reads token by token.

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  // System prompt. For synthesis this is the standing research-assistant prompt
  // from the RAG spec.
  system?: string;
  messages: LlmMessage[];
  // Upper bound on generated tokens. Defaults are the adapter's concern.
  maxTokens?: number;
}

export interface LlmClient {
  // One-shot completion. Resolves with the full markdown answer.
  complete(request: LlmRequest): Promise<string>;
  // Streaming completion. Yields markdown deltas in order; concatenating every
  // yielded chunk reconstructs the full answer. An optional `signal` aborts the
  // upstream call - the RAG query path passes one so a browser disconnect
  // mid-stream stops the paid synthesis instead of running it to completion.
  stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<string>;
}

// Nest DI token; bound by `server-core`.
export const LLM_CLIENT = Symbol('LlmClient');
