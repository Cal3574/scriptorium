import { currentMonthStartUtc, nextMonthStartUtc } from './billing-period.js';

describe('billing-period', () => {
  it('currentMonthStartUtc is the 1st at 00:00 UTC of the given instant', () => {
    const start = currentMonthStartUtc(new Date('2026-03-17T09:41:22.512Z'));
    expect(start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('nextMonthStartUtc is the 1st at 00:00 UTC of the following month', () => {
    const next = nextMonthStartUtc(new Date('2026-03-17T09:41:22.512Z'));
    expect(next.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('nextMonthStartUtc rolls December into January of the next year', () => {
    const next = nextMonthStartUtc(new Date('2026-12-31T23:59:59.999Z'));
    expect(next.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('a row at the exact month start is inside the new month, not the old', () => {
    const boundary = new Date('2026-05-01T00:00:00.000Z');
    expect(currentMonthStartUtc(boundary).toISOString()).toBe(
      '2026-05-01T00:00:00.000Z',
    );
  });
});
