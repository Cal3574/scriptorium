import {
  buildMonthlyActivity,
  trailingTwelveMonths,
} from './monthly-activity.js';

describe('trailingTwelveMonths', () => {
  it('returns 12 UTC month keys, oldest first, ending with the given month', () => {
    const months = trailingTwelveMonths(new Date('2026-09-09T12:00:00.000Z'));
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2025-10');
    expect(months[11]).toBe('2026-09');
  });

  it('crosses the year boundary correctly', () => {
    const months = trailingTwelveMonths(new Date('2026-02-01T00:00:00.000Z'));
    expect(months[0]).toBe('2025-03');
    expect(months[11]).toBe('2026-02');
  });

  it('uses the UTC month even for an instant that is a different month locally', () => {
    // 2026-09-01T00:30 UTC is still August in UTC-2, but we key on UTC.
    const months = trailingTwelveMonths(new Date('2026-09-01T00:30:00.000Z'));
    expect(months[11]).toBe('2026-09');
  });
});

describe('buildMonthlyActivity', () => {
  const now = new Date('2026-09-09T12:00:00.000Z');

  it('zero-fills every month with no activity', () => {
    const rows = buildMonthlyActivity(new Map(), new Map(), now);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.books === 0 && r.questions === 0)).toBe(true);
    expect(rows[0].month).toBe('2025-10');
    expect(rows[11].month).toBe('2026-09');
  });

  it('places counts in their month and leaves the gaps at zero', () => {
    const rows = buildMonthlyActivity(
      new Map([
        ['2026-09', 2],
        ['2026-07', 1],
      ]),
      new Map([['2026-09', 30]]),
      now,
    );
    const month = (key: string) => rows.find((r) => r.month === key);
    expect(month('2026-09')).toEqual({
      month: '2026-09',
      books: 2,
      questions: 30,
    });
    expect(month('2026-08')).toEqual({
      month: '2026-08',
      books: 0,
      questions: 0,
    });
    expect(month('2026-07')).toEqual({
      month: '2026-07',
      books: 1,
      questions: 0,
    });
  });

  it('ignores counts for months outside the trailing-12 window', () => {
    const rows = buildMonthlyActivity(
      new Map([
        ['2025-09', 5], // one month before the window opens
        ['2030-01', 9], // future (clock skew)
      ]),
      new Map(),
      now,
    );
    expect(rows.reduce((sum, r) => sum + r.books, 0)).toBe(0);
  });

  it('keeps a count that lands exactly on the oldest month in the window', () => {
    const rows = buildMonthlyActivity(
      new Map([['2025-10', 3]]),
      new Map(),
      now,
    );
    expect(rows[0]).toEqual({ month: '2025-10', books: 3, questions: 0 });
  });
});
