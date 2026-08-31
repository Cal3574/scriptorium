// @scriptorium/contracts is the wire contract shared between the browser
// client and the API: request/response DTOs, the SSE event schemas, and the
// BullMQ job payloads, all as Zod schemas that are the single source of truth
// for every cross-boundary shape. It is the leaf of the dependency graph -
// `zod` is its only runtime dependency and it imports no other workspace
// package.

export * from './primitives.js';
export * from './user.js';
export * from './book.js';
export * from './query.js';
export * from './ingest.js';
