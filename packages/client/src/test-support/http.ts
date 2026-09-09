// A minimal stand-in for a `fetch` / `useApi` response, enough for the code
// under test: `ok`, `status`, and a `json()` that resolves the given body.
// Several specs grew their own copy of this; prefer importing this one.
export function jsonRes(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}
