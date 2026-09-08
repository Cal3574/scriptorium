import {
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
} from '@nestjs/common';
import { UsageDto, UserDto } from '@scriptorium/contracts';
import {
  type AuthenticatedUser,
  BooksRepository,
  CurrentUser,
  limitsForPlan,
  nextMonthStartUtc,
  PLAN_LIMITS,
  type PlanLimits,
  QueriesRepository,
  resolvePlanSlug,
  UsersRepository,
} from '@scriptorium/server-core';

@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersRepository,
    private readonly books: BooksRepository,
    private readonly queries: QueriesRepository,
    @Inject(PLAN_LIMITS) private readonly planLimits: PlanLimits,
  ) {}

  // The client calls this once on first authenticated load to learn its local
  // identity. The guard has already provisioned the row.
  @Get()
  async me(@CurrentUser() caller: AuthenticatedUser): Promise<UserDto> {
    const row = await this.users.findById(caller.id);
    if (!row) {
      // The guard just upserted this id; a miss here is a serious bug.
      throw new InternalServerErrorException('authenticated user has no row');
    }
    return UserDto.parse({
      id: row.id,
      email: row.email,
      createdAt: row.createdAt.toISOString(),
    });
  }

  // Where the reader stands against their plan limits, for the library
  // toolbar's usage meter. Not quota-guarded - a reader at their ceiling must
  // still be able to see that they are. Counts derive from the reader's own
  // rows via the same two queries the entitlement guard uses; limits and the
  // unknown/absent-plan -> `free` fallback come from the `PLAN_LIMITS` token.
  @Get('usage')
  async usage(@CurrentUser() caller: AuthenticatedUser): Promise<UsageDto> {
    const limits = limitsForPlan(this.planLimits, caller.plan);
    const [books, queries] = await Promise.all([
      this.books.countByUser(caller.id),
      this.queries.countThisMonth(caller.id),
    ]);

    return UsageDto.parse({
      plan: resolvePlanSlug(caller.plan),
      books: { used: books, limit: limits.books },
      queries: {
        used: queries,
        limit: limits.queries,
        resetsAt: nextMonthStartUtc().toISOString(),
      },
    });
  }
}
