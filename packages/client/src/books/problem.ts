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

// The muted foreground for placeholder / "not generated yet" text.
export const MUTED = '#888';
