import { cleanExtractedMarkdown, cleanHeadingText } from './clean-text.js';

describe('cleanHeadingText', () => {
  it('strips inline presentational HTML tags', () => {
    expect(
      cleanHeadingText('<span style="color:#3d3b49">Level of Effort</span>'),
    ).toBe('Level of Effort');
    expect(cleanHeadingText('Working <b>with</b> Katas')).toBe(
      'Working with Katas',
    );
  });

  it('strips nested and unclosed tags', () => {
    expect(cleanHeadingText('<span><i>Deep</i> Work</span>')).toBe('Deep Work');
    expect(cleanHeadingText('<span style="x">Half open')).toBe('Half open');
  });

  it('removes HTML comments', () => {
    expect(cleanHeadingText('Title <!-- editor note --> Here')).toBe(
      'Title Here',
    );
  });

  it('decodes named, numeric and hex HTML entities', () => {
    expect(cleanHeadingText('Cause &amp; Effect')).toBe('Cause & Effect');
    expect(cleanHeadingText('Ma&#241;ana')).toBe('Mañana');
    expect(cleanHeadingText('Slap&#x2019;s')).toBe('Slap’s');
    expect(cleanHeadingText('A&nbsp;B')).toBe('A B');
  });

  it('decodes entities only after tags are removed, so a decoded < cannot form a tag', () => {
    expect(cleanHeadingText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(
      '<script>alert(1)</script>',
    );
  });

  it('converts <br> to a space', () => {
    expect(cleanHeadingText('Line one<br>Line two')).toBe('Line one Line two');
    expect(cleanHeadingText('Line one<br/>Line two')).toBe('Line one Line two');
  });

  it('drops zero-width and control characters', () => {
    expect(cleanHeadingText('Ka\u200btas\ufeff')).toBe('Katas');
    expect(cleanHeadingText('Soft\u00adhyphen')).toBe('Softhyphen');
  });

  it('collapses all whitespace runs and trims', () => {
    expect(cleanHeadingText('  Level   of\tEffort \n')).toBe('Level of Effort');
  });

  it('strips a Markdown emphasis pair only when it wraps the entire string', () => {
    expect(cleanHeadingText('**Level of Effort**')).toBe('Level of Effort');
    expect(cleanHeadingText('*Working with Katas*')).toBe('Working with Katas');
    expect(cleanHeadingText('_Working with Katas_')).toBe('Working with Katas');
    expect(cleanHeadingText('`code title`')).toBe('code title');
    expect(cleanHeadingText('***Bold Italic***')).toBe('Bold Italic');
  });

  it('leaves mid-string and unbalanced emphasis markers alone', () => {
    expect(cleanHeadingText('The Art of *War*')).toBe('The Art of *War*');
    expect(cleanHeadingText('**not closed')).toBe('**not closed');
    expect(cleanHeadingText('snake_case_name')).toBe('snake_case_name');
  });

  it('only strips one level of emphasis', () => {
    expect(cleanHeadingText('**_Doubly Wrapped_**')).toBe('_Doubly Wrapped_');
  });

  it('is idempotent', () => {
    const once = cleanHeadingText(
      '<span>Cause &amp; <b>Effect</b></span>\u200b',
    );
    expect(cleanHeadingText(once)).toBe(once);
  });

  it('returns an empty string for tag-only input', () => {
    expect(cleanHeadingText('<span style="color:#3d3b49"></span>')).toBe('');
  });
});

describe('cleanExtractedMarkdown', () => {
  it('strips inline HTML while preserving Markdown structure', () => {
    const input = [
      '## <span style="color:#3d3b49">Chapter 1. Level of Effort</span>',
      '',
      'A paragraph with <b>bold</b> and a <span>styled</span> word.',
      '',
      '- item <i>one</i>',
      '- item two',
      '',
      '| Col A | Col B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');
    expect(cleanExtractedMarkdown(input)).toBe(
      [
        '## Chapter 1. Level of Effort',
        '',
        'A paragraph with bold and a styled word.',
        '',
        '- item one',
        '- item two',
        '',
        '| Col A | Col B |',
        '| --- | --- |',
        '| 1 | 2 |',
      ].join('\n'),
    );
  });

  it('does not strip Markdown emphasis in body prose', () => {
    expect(cleanExtractedMarkdown('This is *very* important.')).toBe(
      'This is *very* important.',
    );
  });

  it('converts <br> to a newline', () => {
    expect(cleanExtractedMarkdown('Line one<br>Line two')).toBe(
      'Line one\nLine two',
    );
  });

  it('decodes entities and drops zero-width characters', () => {
    expect(cleanExtractedMarkdown('Cause &amp; effect\u200b here')).toBe(
      'Cause & effect here',
    );
  });

  it('collapses intra-line whitespace but preserves leading indentation', () => {
    expect(cleanExtractedMarkdown('  - nested    item   here')).toBe(
      '  - nested item here',
    );
  });

  it('removes multi-line HTML comments', () => {
    expect(
      cleanExtractedMarkdown('before\n<!-- a\nmultiline\ncomment -->\nafter'),
    ).toBe('before\n\nafter');
  });

  it('preserves blank lines between blocks', () => {
    expect(cleanExtractedMarkdown('a\n\n\nb')).toBe('a\n\n\nb');
  });
});
