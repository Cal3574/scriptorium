import {
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
} from '@nestjs/common';
import { ActivityDto, UsageDto, UserDto } from '@scriptorium/contracts';
import {
  ActivityRepository,
  type AuthenticatedUser,
  BooksRepository,
  buildMonthlyActivity,
  CurrentUser,
  limitsForPlan,
  nextMonthStartUtc,
  PLAN_LIMITS,
  type PlanLimits,
  QueriesRepository,
  resolvePlanSlug,
  UsersRepository,
} from '@scriptorium/server-core';

// The question allowance's standing, shared by `GET /me/usage` and
// `GET /me/activity` so the two never disagree on the month's count, the
// ceiling, or the reset instant.
interface QuestionAllowance {
  plan: 'free' | 'pro';
  used: number;
  limit: number;
  resetsAt: string;
}

@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersRepository,
    private readonly books: BooksRepository,
    private readonly queries: QueriesRepository,
    private readonly activity: ActivityRepository,
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
    const [books, questions] = await Promise.all([
      this.books.countByUser(caller.id),
      this.questionAllowance(caller),
    ]);

    return UsageDto.parse({
      plan: questions.plan,
      books: { used: books, limit: limits.books },
      queries: {
        used: questions.used,
        limit: questions.limit,
        resetsAt: questions.resetsAt,
      },
    });
  }

  // The `/activity` dashboard: lifetime totals, the current question
  // allowance, a trailing-12-month upload/question series, and the reader's
  // most-asked books. Not quota-guarded, same as `/usage`. One fetch per page
  // visit; every figure derives from the caller's own rows.
  @Get('activity')
  async getActivity(
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ActivityDto> {
    const now = new Date();
    // Start of the oldest of the trailing 12 UTC calendar months.
    const windowStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1),
    );

    const [totals, allowance, monthlyBooks, monthlyQuestions, topBooks] =
      await Promise.all([
        this.activity.lifetimeTotals(caller.id),
        this.questionAllowance(caller),
        this.activity.monthlyBookUploads(caller.id, windowStart),
        this.activity.monthlyQuestions(caller.id, windowStart),
        this.activity.topBooksByQuestions(caller.id, 5),
      ]);

    return ActivityDto.parse({
      totals,
      plan: {
        plan: allowance.plan,
        questionsUsed: allowance.used,
        questionsLimit: allowance.limit,
        resetsAt: allowance.resetsAt,
      },
      monthly: buildMonthlyActivity(monthlyBooks, monthlyQuestions, now),
      topBooks,
    });
  }

  private async questionAllowance(
    caller: AuthenticatedUser,
  ): Promise<QuestionAllowance> {
    const limits = limitsForPlan(this.planLimits, caller.plan);
    const used = await this.queries.countThisMonth(caller.id);
    return {
      plan: resolvePlanSlug(caller.plan),
      used,
      limit: limits.queries,
      resetsAt: nextMonthStartUtc().toISOString(),
    };
  }
}
