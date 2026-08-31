import { cyrb53, mulberry32 } from '../internal/deterministic-random.js';
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingClient,
} from './embedding-client.js';

/**
 * Offline {@link EmbeddingClient}. The vector for a text is derived purely from
 * a hash of that text, so the same string always embeds to the same vector and
 * cosine similarity between any two texts is stable across runs and processes.
 *
 * There is no semantic content: similar strings do not get similar vectors, so
 * RAG relevance in fake mode is effectively random. That is deliberate - fake
 * mode proves the plumbing (the pgvector query runs, top-k returns rows,
 * citations render), not retrieval quality.
 */
export class FakeEmbeddingClient implements EmbeddingClient {
  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.embedOne(text)));
  }

  private embedOne(text: string): number[] {
    const next = mulberry32(cyrb53(text) >>> 0);
    const vector = new Array<number>(EMBEDDING_DIMENSIONS);
    let sumSquares = 0;
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      // map [0, 1) -> [-1, 1)
      const value = next() * 2 - 1;
      vector[i] = value;
      sumSquares += value * value;
    }
    // L2-normalise. sumSquares is > 0 in practice (1536 draws); guard anyway.
    const norm = Math.sqrt(sumSquares) || 1;
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      vector[i] /= norm;
    }
    return vector;
  }
}
