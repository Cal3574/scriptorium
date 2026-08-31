import OpenAI from 'openai';
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingClient,
} from './embedding-client.js';

// The data model pins embeddings to OpenAI `text-embedding-3-small` at its
// native 1536 dimensions (the `chunks.embedding` column width). The embed
// stage batches inputs; the batch caps (2048 inputs / 300k tokens per request)
// are enforced by the caller, not here.
const MODEL = 'text-embedding-3-small';

export interface OpenAiEmbeddingClientOptions {
  apiKey: string;
  model?: string;
}

export class OpenAiEmbeddingClient implements EmbeddingClient {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiEmbeddingClientOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.model = options.model ?? MODEL;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    // The API returns rows in input order, but sort on `index` to be safe.
    return [...response.data]
      .sort((a, b) => a.index - b.index)
      .map((row) => row.embedding);
  }
}
