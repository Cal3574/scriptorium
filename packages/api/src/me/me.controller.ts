import {
  Controller,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Logger,
  Post,
} from '@nestjs/common';
import {
  ActivityDto,
  BackfillCoversResponse,
  UsageDto,
  UserDto,
} from '@scriptorium/contracts';
import {
  ActivityRepository,
  AgentRepository,
  type AuthenticatedUser,
  BooksRepository,
  buildMonthlyActivity,
  CurrentUser,
  limitsForPlan,
  nextMonthStartUtc,
  OBJECT_STORAGE,
  type ObjectStorage,
  PLAN_LIMITS,
  type PlanLimits,
  QueriesRepository,
  renderBookCover,
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
  private readonly logger = new Logger(MeController.name);

  // Bounds one HTTP request's worth of synchronous PDF-render work. Not a
  // pagination cursor like the worker's global backfill - a caller's total
  // book count is already capped by their plan's `@Quota('books')` ceiling,
  // so "every missing cover this caller could possibly have" comfortably
  // fits under this in a single pass.
  private static readonly BACKFILL_LIMIT = 200;

  constructor(
    private readonly users: UsersRepository,
    private readonly books: BooksRepository,
    private readonly queries: QueriesRepository,
    private readonly agent: AgentRepository,
    private readonly activity: ActivityRepository,
    @Inject(PLAN_LIMITS) private readonly planLimits: PlanLimits,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
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
    // Pooled across Ask library and Agent mode - the same monthly allowance,
    // matching the `EntitlementGuard`'s `queries` lever exactly.
    const [askUsed, agentUsed] = await Promise.all([
      this.queries.countThisMonth(caller.id),
      this.agent.countMessagesThisMonth(caller.id),
    ]);
    const used = askUsed + agentUsed;
    return {
      plan: resolvePlanSlug(caller.plan),
      used,
      limit: limits.queries,
      resetsAt: nextMonthStartUtc().toISOString(),
    };
  }

  // Self-service repair for books uploaded before the client started sending
  // its own rendered first-page thumbnail: render one for every book the
  // caller owns that still has none. Never touches another reader's rows
  // (`listMissingCovers`'s `userId` scope) and never throws on an individual
  // book's failure - a missing or unrenderable PDF is logged and skipped, the
  // same as the worker's global backfill (`CoverBackfillService`), so one bad
  // book cannot fail the whole request. Idempotent: a book that already has a
  // cover is not touched, and a caller with nothing missing gets back
  // `{ processed: 0, updated: 0, skipped: 0 }` almost instantly. Not
  // quota-guarded - it repairs rows the caller already paid the book quota
  // for, it does not create new ones.
  @Post('backfill-covers')
  @HttpCode(200)
  async backfillCovers(
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<BackfillCoversResponse> {
    const result = { processed: 0, updated: 0, skipped: 0 };
    const missing = await this.books.listMissingCovers(
      MeController.BACKFILL_LIMIT,
      [],
      caller.id,
    );

    for (const book of missing) {
      result.processed += 1;
      try {
        const dataUrl = await renderBookCover(this.storage, book);
        await this.books.setCoverImageUrl(book.id, dataUrl);
        result.updated += 1;
      } catch (err) {
        this.logger.warn(
          `book ${book.id}: cover render failed (${
            err instanceof Error ? err.message : String(err)
          }), skipping`,
        );
        result.skipped += 1;
      }
    }

    return BackfillCoversResponse.parse(result);
  }
}
