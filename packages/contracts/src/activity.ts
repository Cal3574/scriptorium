import { z } from 'zod';
import { isoTimestamp, uuid } from './primitives.js';
import { PlanSlug } from './usage.js';

// The reader's activity dashboard, as returned by `GET /api/v1/me/activity`
// and rendered by the `/activity` screen. Everything is derived server-side
// from the reader's own `books` and `queries` rows; the plan ceiling comes
// from the same `PLAN_LIMITS` token that feeds `GET /me/usage` and the
// entitlement guard.
//
// This DTO is deliberately a bag of independent sections so a future metric
// is one more key, not a reshape.

// Lifetime totals - every row counted, matching the entitlement guard's
// "a row is a slot" rule: a `failed` book and a query whose synthesis failed
// (`answer is null`) both still count, because the paid work ran.
export const ActivityTotalsDto = z.object({
  books: z.number().int().nonnegative(),
  questions: z.number().int().nonnegative(),
  // Sum of `books.page_count`, which is written at the `extract` stage. A book
  // that never reached extraction contributes nothing; one that failed a later
  // stage keeps the page count it already had, so this reads as "pages we ran
  // extraction over".
  pagesIngested: z.number().int().nonnegative(),
});
export type ActivityTotalsDto = z.infer<typeof ActivityTotalsDto>;

// The single quota nod on the page: the question allowance only (the book
// limit is a lifetime slot count, already a headline total). Same UTC
// calendar-month window and `resetsAt` instant as `GET /me/usage`.
export const ActivityPlanDto = z.object({
  plan: PlanSlug,
  questionsUsed: z.number().int().nonnegative(),
  questionsLimit: z.number().int().positive(),
  resetsAt: isoTimestamp,
});
export type ActivityPlanDto = z.infer<typeof ActivityPlanDto>;

// One month of the trailing-12 series. `month` is a `YYYY-MM` key in UTC;
// the array is always exactly 12 entries, oldest first, zero-filled.
export const ActivityMonthDto = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  books: z.number().int().nonnegative(),
  questions: z.number().int().nonnegative(),
});
export type ActivityMonthDto = z.infer<typeof ActivityMonthDto>;

// One row of the "most-asked books" list. Only books the reader still owns
// appear (a deleted book's queries have `book_id` set to null and drop out),
// and only book-filtered questions are counted, so `questionCount` is always
// at least 1.
export const ActivityTopBookDto = z.object({
  bookId: uuid,
  title: z.string().min(1),
  questionCount: z.number().int().positive(),
});
export type ActivityTopBookDto = z.infer<typeof ActivityTopBookDto>;

export const ActivityDto = z.object({
  totals: ActivityTotalsDto,
  plan: ActivityPlanDto,
  monthly: z.array(ActivityMonthDto).length(12),
  topBooks: z.array(ActivityTopBookDto).max(5),
});
export type ActivityDto = z.infer<typeof ActivityDto>;
