import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '@scriptorium/database/client';
import { users } from '@scriptorium/database/schema';
import { eq } from 'drizzle-orm';
import { DB } from '../database/database.module.js';

// The local identity row, as the rest of the server sees it. `id` is the
// ownership key behind every `user_id` foreign key.
export interface LocalUser {
  id: string;
  clerkUserId: string;
  email: string;
  createdAt: Date;
}

/**
 * The only writer of the `users` table. The auth guard calls
 * {@link upsertFromClerk} on every authenticated request to provision the row
 * just-in-time and keep `email` fresh from the token.
 */
@Injectable()
export class UsersRepository {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  /**
   * Insert the user keyed on `clerkUserId`, or refresh `email` / `updatedAt`
   * if the row already exists. Returns the local row either way.
   */
  async upsertFromClerk(input: {
    clerkUserId: string;
    email: string;
  }): Promise<LocalUser> {
    const [row] = await this.db
      .insert(users)
      .values({ clerkUserId: input.clerkUserId, email: input.email })
      .onConflictDoUpdate({
        target: users.clerkUserId,
        set: { email: input.email, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async findById(id: string): Promise<LocalUser | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row;
  }
}
