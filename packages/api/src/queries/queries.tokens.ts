import type { SelectionConfig } from './select-chunks.js';

// DI token for the resolved RAG tuning knobs, provided by `AppModule` from the
// loaded `ApiConfig` so the query service never imports the config loader.
export const RAG_CONFIG = 'RAG_CONFIG';

export interface RagConfig extends SelectionConfig {
  // `SET LOCAL hnsw.ef_search` per retrieval query.
  efSearch: number;
  // The candidate pool `LIMIT`.
  poolLimit: number;
}
