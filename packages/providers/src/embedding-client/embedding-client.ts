// The seam between the pipeline / RAG query path and text embeddings. The live
// adapter calls OpenAI `text-embedding-3-small`; the fake returns deterministic
// hash-seeded vectors. Both return L2-normalised vectors of EMBEDDING_DIMENSIONS
// so cosine distance, dot product and pgvector's `<=>` all agree (the schema's
// HNSW index is built with `vector_cosine_ops`).

// Native dimension of OpenAI `text-embedding-3-small`, and the fixed width of
// the `chunks.embedding` column.
export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingClient {
  // Embed a batch of texts. The result has one vector per input, in order,
  // each L2-normalised and EMBEDDING_DIMENSIONS long. An empty input returns
  // an empty array.
  embed(texts: string[]): Promise<number[][]>;
}

// Nest DI token; bound by `server-core`.
export const EMBEDDING_CLIENT = Symbol('EmbeddingClient');
