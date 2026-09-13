// The full Drizzle schema, re-exported as one module. `createDbClient` passes
// `import * as schema from './schema'` to `drizzle()` for the typed query API,
// and `drizzle-kit` reads this file (via `drizzle.config.ts`) to generate
// migrations.
export { agentMessageRole, bookStatus } from './enums.js';
export { users } from './users.js';
export { books } from './books.js';
export { chapters } from './chapters.js';
export { chunks } from './chunks.js';
export { queries } from './queries.js';
export { agentThreads } from './agent-threads.js';
export { agentMessages } from './agent-messages.js';
