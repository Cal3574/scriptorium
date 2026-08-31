import { z } from 'zod';
import { isoTimestamp, uuid } from './primitives.js';

// The local user identity, as returned by `GET /api/v1/me`. Clerk owns
// authentication; this is the subset the client is allowed to see. No Clerk
// `sub`, no roles - the client already holds the Clerk user object for display.
export const UserDto = z.object({
  id: uuid,
  email: z.string().email(),
  createdAt: isoTimestamp,
});
export type UserDto = z.infer<typeof UserDto>;
