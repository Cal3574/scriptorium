// "Ask again" re-runs a past question as a fresh `POST /queries`. Under the URL
// model that is a navigation to the ask form with the question pre-filled via
// `?q=`; building that path lives here so the two call sites (a failed history
// row, the detail view) can never drift apart.
export function askAgainPath(question: string): string {
  return `/ask?q=${encodeURIComponent(question)}`;
}
