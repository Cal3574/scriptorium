import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from './current-user.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { TokenVerifier } from './token-verifier.js';
import { UsersRepository } from '../users/users.repository.js';

/**
 * Runs on every request (registered as an `APP_GUARD`). It:
 *   1. lets `@Public()` routes straight through,
 *   2. verifies the `Authorization: Bearer` token with `@clerk/backend`,
 *   3. JIT-upserts the local `users` row, refreshing `email`,
 *   4. attaches `req.user = { id, clerkUserId, email }` with the local id.
 *
 * There is no bypass branch - the same guard runs in tests, which sign
 * tokens with a locally-minted RSA key.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenVerifier: TokenVerifier,
    private readonly users: UsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('missing bearer token');
    }

    let verified;
    try {
      verified = await this.tokenVerifier.verify(token);
    } catch {
      throw new UnauthorizedException('invalid bearer token');
    }

    const user = await this.users.upsertFromClerk({
      clerkUserId: verified.sub,
      email: verified.email,
    });
    request.user = {
      id: user.id,
      clerkUserId: user.clerkUserId,
      email: user.email,
    };
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim() || null;
}
