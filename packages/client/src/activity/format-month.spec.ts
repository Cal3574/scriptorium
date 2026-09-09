import { formatMonthLabel } from './format-month';

describe('formatMonthLabel', () => {
  it('renders a mid-year month as its short name', () => {
    expect(formatMonthLabel('2026-09')).toBe('Sep');
  });

  it('tags January with the 2-digit year', () => {
    expect(formatMonthLabel('2026-01')).toBe("Jan '26");
  });

  it('is stable regardless of the host timezone (UTC month key)', () => {
    // 2026-03 must never render as Feb because the runner is behind UTC.
    expect(formatMonthLabel('2026-03')).toBe('Mar');
  });
});
