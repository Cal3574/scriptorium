import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClerkAuthGuard } from './clerk-auth.guard.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { TokenVerifier } from './token-verifier.js';
import type { UsersRepository } from '../users/users.repository.js';

function contextFor(
  headers: Record<string, string | undefined>,
  isPublic = false,
): { ctx: ExecutionContext; request: { user?: unknown } } {
  const request: { headers: typeof headers; user?: unknown } = { headers };
  const handler = () => undefined;
  if (isPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('ClerkAuthGuard', () => {
  const users = {
    upsertFromClerk: jest.fn(async ({ clerkUserId, email }) => ({
      id: 'local-1',
      clerkUserId,
      email,
      createdAt: new Date(),
    })),
  } as unknown as UsersRepository;

  const verifier: TokenVerifier = {
    verify: jest.fn(async () => ({ sub: 'user_x', email: 'x@example.com' })),
  };

  const guard = new ClerkAuthGuard(new Reflector(), verifier, users);

  afterEach(() => jest.clearAllMocks());

  it('lets @Public() routes through untouched', async () => {
    const { ctx } = contextFor({}, true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('rejects a request with no bearer token', async () => {
    const { ctx } = contextFor({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when verification throws', async () => {
    (verifier.verify as jest.Mock).mockRejectedValueOnce(new Error('bad sig'));
    const { ctx } = contextFor({ authorization: 'Bearer abc' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the local user id (not the Clerk sub) on success', async () => {
    const { ctx, request } = contextFor({ authorization: 'Bearer abc' });
    await guard.canActivate(ctx);
    expect(request.user).toEqual({
      id: 'local-1',
      clerkUserId: 'user_x',
      email: 'x@example.com',
    });
  });
});
