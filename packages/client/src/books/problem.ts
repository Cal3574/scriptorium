// Pull a human message out of an RFC 9457 problem+json body, falling back to
// the machine `code` and then to null. Shared by every books screen that
// surfaces an API error.
export async function problemMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { code?: string; detail?: string };
    return body.detail ?? body.code ?? null;
  } catch {
    return null;
  }
}

// The plan-limit problem codes the API returns as HTTP 402 (server-core's
// `BookLimitReachedException` / `QueryLimitReachedException`). The client
// switches on these to swap its inline error for the limit-reached notice.
export const LIMIT_CODES = [
  'book_limit_reached',
  'query_limit_reached',
] as const;
export type LimitCode = (typeof LIMIT_CODES)[number];

// If `res` is a plan-limit 402, return which limit was hit; otherwise null.
// A 402 always means a cap was reached, so a call site that gets a non-null
// result should render the notice and stop - it never also needs the
// `problemMessage`, so consuming the body here is safe.
export async function isLimitReached(res: Response): Promise<LimitCode | null> {
  if (res.status !== 402) return null;
  try {
    const body = (await res.json()) as { code?: string };
    return LIMIT_CODES.includes(body.code as LimitCode)
      ? (body.code as LimitCode)
      : null;
  } catch {
    return null;
  }
}

// The muted foreground for placeholder / "not generated yet" text.
export const MUTED = '#888';
