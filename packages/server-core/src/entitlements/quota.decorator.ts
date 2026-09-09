import { SetMetadata } from '@nestjs/common';

export type QuotaLever = 'books' | 'queries';

export const QUOTA_KEY = 'scriptorium:quota';

/**
 * Marks a handler as counting against a plan quota. The {@link EntitlementGuard}
 * - applied with `@UseGuards(EntitlementGuard)` on the controller, so it runs
 * after the global auth guard - resolves the caller's limit and rejects with
 * HTTP 402 when they are at or over it. A handler with no `@Quota`, or a
 * controller without `@UseGuards(EntitlementGuard)`, is not enforced.
 */
export const Quota = (lever: QuotaLever) => SetMetadata(QUOTA_KEY, lever);
