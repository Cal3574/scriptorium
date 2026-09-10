import { chapterHeading, chapterOrdinal, pageRange } from './chapter-display';

describe('pageRange', () => {
  it('renders "start-end" when both bounds exist', () => {
    expect(pageRange({ pageStart: 41, pageEnd: 58 })).toBe('41–58');
  });

  it('is null when either bound is missing', () => {
    expect(pageRange({ pageStart: null, pageEnd: 58 })).toBeNull();
    expect(pageRange({ pageStart: 41, pageEnd: null })).toBeNull();
  });
});

describe('chapterHeading', () => {
  it('uses the title, else "Chapter N"', () => {
    expect(chapterHeading({ title: 'The Habit Loop' }, 3)).toBe(
      'The Habit Loop',
    );
    expect(chapterHeading({ title: null }, 3)).toBe('Chapter 3');
  });
});

describe('chapterOrdinal', () => {
  it('zero-pads to two digits', () => {
    expect(chapterOrdinal(1)).toBe('01');
    expect(chapterOrdinal(12)).toBe('12');
  });
});
