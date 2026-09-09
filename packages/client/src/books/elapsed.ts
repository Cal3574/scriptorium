// A compact running span for the ingest panel - "Started 4m ago", "Done in
// 1h 2m". Measured from the book's `createdAt` (≈ upload time), the one time
// reference the SSE stream does not carry. Seconds show only under a minute
// and in the first minute; past an hour the seconds drop entirely.
export function formatElapsed(
  fromIso: string,
  now: number = Date.now(),
): string {
  const total = Math.floor((now - Date.parse(fromIso)) / 1000);
  if (total < 5) return 'just now';
  if (total < 60) return `${total}s`;

  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) {
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}
