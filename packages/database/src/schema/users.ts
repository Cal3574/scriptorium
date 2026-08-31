import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Local identity. Clerk owns authentication; `users.id` is the ownership key
// behind every `user_id` foreign key and the authorization guard. Rows are
// provisioned by JIT upsert in the auth guard, keyed on `clerk_user_id`. No
// name / image / roles - the client already holds the Clerk user object.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Clerk's `sub` claim. Unique - the JIT-upsert lookup key.
    clerkUserId: text('clerk_user_id').notNull(),
    // Denormalised from Clerk for support / debug lookup; refreshed on each
    // JIT upsert.
    email: text('email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // App-maintained (the repository layer sets it on every update), not a
    // Postgres trigger.
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('users_clerk_user_id_key').on(table.clerkUserId)],
);
