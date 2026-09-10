// The reader's routes carry a 1-based `:chapterNumber` (`/read/1` is the first
// chapter). This converts it once to a 0-based array index, returning null for
// anything that is not a whole number in `1..chapterCount` - the layout turns a
// null into a redirect to the Overview.
export function chapterIndexFromParam(
  raw: string | undefined,
  chapterCount: number,
): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const number = Number(raw);
  if (number < 1 || number > chapterCount) return null;
  return number - 1;
}
