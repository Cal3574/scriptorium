import {
  createParamDecorator,
  type ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';

// What the guard attaches to `req.user` after verifying the token and
// provisioning the local row. `id` is the local `users.id` - the ownership
// key for every authorization check, never the Clerk `sub`.
export interface AuthenticatedUser {
  id: string;
  clerkUserId: string;
  email: string;
}

/**
 * Injects the authenticated caller into a handler param. Throws if used on a
 * route that never ran the guard (i.e. an `@Public()` route) - that is a
 * wiring bug, not a client error.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new InternalServerErrorException(
        '@CurrentUser() used on a route without the auth guard',
      );
    }
    return request.user;
  },
);
