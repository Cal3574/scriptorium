import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../auth/current-user.decorator.js';
import { BooksRepository } from '../books/books.repository.js';
import { QueriesRepository } from '../queries/queries.repository.js';
import {
  BookLimitReachedException,
  QueryLimitReachedException,
} from './entitlement.problems.js';
import { limitsForPlan, type PlanLimits, PLAN_LIMITS } from './plan-limits.js';
import { QUOTA_KEY, type QuotaLever } from './quota.decorator.js';

/**
 * Enforces the plan quotas. Applied with `@UseGuards(EntitlementGuard)` on each
 * quota-bearing controller in the api app - not an `APP_GUARD` - because Nest
 * runs global guards before controller guards, which is a hard guarantee that
 * the global {@link ClerkAuthGuard} has already populated `req.user.plan`. A
 * handler with no `@Quota` metadata passes straight through; otherwise the
 * caller's limit is resolved from {@link PLAN_LIMITS} (unknown/absent plan ->
 * `free`) and the derive-from-rows count is checked with `count >= limit`.
 *
 * The `books` lever is wired now (`BooksController`); the `queries` lever and
 * its `@Quota('queries')` land in the query ticket (#106), which adds
 * `@UseGuards(EntitlementGuard)` to `QueriesController`.
 *
 * There is no row locking: two concurrent requests can both pass at
 * `limit - 1` and overshoot by one. Accepted for v1. Downgrade grace falls out
 * of the same check with no special case - a former Pro user over the free
 * ceiling is blocked from new writes, and every read/retry path is unguarded.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PLAN_LIMITS) private readonly planLimits: PlanLimits,
    private readonly books: BooksRepository,
    private readonly queries: QueriesRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const lever = this.reflector.getAllAndOverride<QuotaLever | undefined>(
      QUOTA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!lever) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      throw new InternalServerErrorException(
        'EntitlementGuard ran before the auth guard',
      );
    }

    const limits = limitsForPlan(this.planLimits, user.plan);

    if (lever === 'books') {
      const count = await this.books.countByUser(user.id);
      if (count >= limits.books) {
        throw new BookLimitReachedException();
      }
      return true;
    }

    const count = await this.queries.countThisMonth(user.id);
    if (count >= limits.queries) {
      throw new QueryLimitReachedException();
    }
    return true;
  }
}
