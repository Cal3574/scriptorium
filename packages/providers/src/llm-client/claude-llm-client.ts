import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmRequest } from './llm-client.js';

// The RAG spec pins synthesis to `claude-sonnet-5` with `max_tokens: 1500` and
// no temperature override; chapter detection's identify-book call uses the same
// model. Both are overridable per request / per construction.
const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_MAX_TOKENS = 1500;

export interface ClaudeLlmClientOptions {
  apiKey: string;
  model?: string;
}

export class ClaudeLlmClient implements LlmClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: ClaudeLlmClientOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_MODEL;
  }

  private toParams(
    request: LlmRequest,
  ): Anthropic.MessageCreateParamsNonStreaming {
    return {
      model: this.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(request.system ? { system: request.system } : {}),
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
  }

  async complete(request: LlmRequest): Promise<string> {
    const message = await this.client.messages.create(this.toParams(request));
    return message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }

  async *stream(
    request: LlmRequest,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    const stream = this.client.messages.stream(this.toParams(request), {
      signal,
    });
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }
}
