import { z } from 'zod';

// RFC 9457 Problem Details - the body of every non-2xx response the API
// returns. The client switches on `code` (stable, machine-readable); `title`
// and `detail` are human text and may change. `instance` is the request's
// `X-Request-Id`. `errors` is present only on `422` schema failures - the
// flattened Zod issues.
export const ProblemDetail = z.object({
  path: z.string(),
  message: z.string(),
});
export type ProblemDetail = z.infer<typeof ProblemDetail>;

export const ProblemDetails = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: z.string(),
  instance: z.string(),
  errors: z.array(ProblemDetail).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;

// The `Content-Type` every Problem response carries.
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

// `type` URIs live under this prefix, one per `code`.
export const PROBLEM_TYPE_PREFIX = 'https://scriptorium.app/problems/';
