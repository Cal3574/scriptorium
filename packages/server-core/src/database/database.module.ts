import {
  type DynamicModule,
  Global,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createDbClient, type DbClient } from '@scriptorium/database/client';

// Nest DI token for the one Drizzle client every server process shares. A
// plain string keeps the token importable without pulling the module in.
export const DB = 'DB_CLIENT';

/**
 * Opens the single Postgres connection pool for the process and exposes the
 * Drizzle client under {@link DB}. Global, so any provider in any module can
 * `@Inject(DB)` without re-importing. The pool is closed on shutdown.
 */
@Global()
@Module({})
export class DatabaseModule {
  static forRoot(config: { DATABASE_URL: string }): DynamicModule {
    const db = createDbClient(config.DATABASE_URL);
    return {
      module: DatabaseModule,
      providers: [
        { provide: DB, useValue: db },
        {
          provide: DatabaseShutdown,
          useFactory: () => new DatabaseShutdown(db),
        },
      ],
      exports: [DB],
    };
  }
}

// Registered only so Nest calls `onApplicationShutdown`; nothing injects it.
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(private readonly db: DbClient) {}

  async onApplicationShutdown(): Promise<void> {
    await (
      this.db as unknown as { $client: { end: () => Promise<void> } }
    ).$client.end();
  }
}
