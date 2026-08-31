import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'scriptorium:isPublic';

/**
 * Opts a route out of the global {@link ClerkAuthGuard}. Only `GET /health`
 * and the SSE progress route are public - every other route needs a bearer
 * token.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
