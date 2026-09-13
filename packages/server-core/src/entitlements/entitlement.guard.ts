import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AgentRepository } from '../agent/agent.repository.js';
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
 * The `books` lever guards `BooksController`; the `queries` lever guards both
 * `QueriesController` (Ask library) and `AgentController` (the reading
 * companion) - the two modes spend one pooled monthly allowance, so the count
 * sums `queries` rows and Agent turns (`agent_messages` `role: 'user'` rows).
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
    private readonly agent: AgentRepository,
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

    const [queryCount, agentTurnCount] = await Promise.all([
      this.queries.countThisMonth(user.id),
      this.agent.countMessagesThisMonth(user.id),
    ]);
    if (queryCount + agentTurnCount >= limits.queries) {
      throw new QueryLimitReachedException();
    }
    return true;
  }
}
