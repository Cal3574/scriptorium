// `2026-09` -> `Sep`, and `2026-01` -> `Jan '26` so a 12-bar axis that spans a
// year boundary still says which year each end is in. UTC-based: the key is a
// UTC calendar month, so the label must not shift by the viewer's timezone.
export function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, 1));
  const name = date.toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  return monthNumber === 1 ? `${name} '${String(year).slice(-2)}` : name;
}
