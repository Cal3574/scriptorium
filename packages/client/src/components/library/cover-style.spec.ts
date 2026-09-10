import { COVER_PALETTE, coverStyle, coverInitials } from './cover-style';

describe('coverStyle', () => {
  it('is deterministic for a given id', () => {
    expect(coverStyle('book-abc')).toEqual(coverStyle('book-abc'));
  });

  it('always resolves to a palette entry', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      expect(COVER_PALETTE).toContain(coverStyle(id));
    }
  });

  it('spreads ids across more than one palette entry', () => {
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) => coverStyle(`id-${i}`)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it('tolerates an empty id', () => {
    expect(COVER_PALETTE).toContain(coverStyle(''));
  });
});

describe('coverInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(coverInitials('Deep Work')).toBe('DW');
  });

  it('falls back to two letters of a single word', () => {
    expect(coverInitials('Meditations')).toBe('ME');
  });

  it('ignores surrounding whitespace and blank titles', () => {
    expect(coverInitials('   ')).toBe('');
    expect(coverInitials(null)).toBe('');
  });

  it('skips articles when a later word is more distinctive', () => {
    expect(coverInitials('The Pragmatic Programmer')).toBe('PP');
  });
});
