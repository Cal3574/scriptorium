import { formatElapsed } from './elapsed';

const start = Date.parse('2026-09-09T12:00:00.000Z');
const at = (s: number) => start + s * 1000;

describe('formatElapsed', () => {
  it('reads "just now" under 5 seconds', () => {
    expect(formatElapsed('2026-09-09T12:00:00.000Z', at(3))).toBe('just now');
  });

  it('counts seconds, then minutes', () => {
    expect(formatElapsed('2026-09-09T12:00:00.000Z', at(42))).toBe('42s');
    expect(formatElapsed('2026-09-09T12:00:00.000Z', at(90))).toBe('1m 30s');
    expect(formatElapsed('2026-09-09T12:00:00.000Z', at(300))).toBe('5m');
  });

  it('adds hours once past 60 minutes', () => {
    expect(formatElapsed('2026-09-09T12:00:00.000Z', at(3720))).toBe('1h 2m');
  });

  it('never returns a negative span', () => {
    expect(formatElapsed('2026-09-09T12:00:00.000Z', at(-10))).toBe('just now');
  });
});
