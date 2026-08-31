// Development seed. Idempotent - safe to run repeatedly. Provisions a single
// local dev user so the app has an ownership identity to hang books off before
// a real Clerk sign-in. Everything else (books, chapters, chunks) is produced
// by the ingest pipeline, not seeded.
import { withClient } from './db-client.mjs';

const DEV_CLERK_USER_ID = 'user_local_dev';
const DEV_EMAIL = 'dev@scriptorium.local';

await withClient(async (client) => {
  const { rows } = await client.query(
    `INSERT INTO users (clerk_user_id, email)
     VALUES ($1, $2)
     ON CONFLICT (clerk_user_id) DO UPDATE SET email = EXCLUDED.email, updated_at = now()
     RETURNING id`,
    [DEV_CLERK_USER_ID, DEV_EMAIL],
  );
  console.log(`seed: dev user ${rows[0].id} ready`);
});
