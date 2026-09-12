import { renderDocument } from './render-document.js';
import type { DoclingDocument } from './docling-document.js';

function doc(partial: Partial<DoclingDocument>): DoclingDocument {
  return {
    texts: [],
    groups: [],
    tables: [],
    pictures: [],
    body: { self_ref: '#/body', children: [] },
    ...partial,
  };
}

describe('renderDocument', () => {
  it('renders a title and section headers at the right heading level', () => {
    const d = doc({
      texts: [
        { self_ref: '#/texts/0', label: 'title', text: 'My Book', prov: [{ page_no: 1 }] },
        {
          self_ref: '#/texts/1',
          label: 'section_header',
          text: 'Chapter One',
          level: 1,
          prov: [{ page_no: 1 }],
        },
        {
          self_ref: '#/texts/2',
          label: 'section_header',
          text: 'A subsection',
          level: 2,
          prov: [{ page_no: 2 }],
        },
      ],
      body: {
        self_ref: '#/body',
        children: [
          { $ref: '#/texts/0' },
          { $ref: '#/texts/1' },
          { $ref: '#/texts/2' },
        ],
      },
    });

    const { pages, markdown } = renderDocument(d, 2);

    expect(pages).toEqual([
      { page: 1, markdown: '# My Book\n\n## Chapter One' },
      { page: 2, markdown: '### A subsection' },
    ]);
    expect(markdown).toBe(
      '<!-- page 1 -->\n# My Book\n\n## Chapter One\n\n<!-- page 2 -->\n### A subsection\n',
    );
  });

  it('renders plain text and list items without a heading prefix', () => {
    const d = doc({
      texts: [
        { self_ref: '#/texts/0', label: 'text', text: 'Once upon a time.', prov: [{ page_no: 1 }] },
        { self_ref: '#/texts/1', label: 'list_item', text: 'First', prov: [{ page_no: 1 }] },
      ],
      body: {
        self_ref: '#/body',
        children: [{ $ref: '#/texts/0' }, { $ref: '#/texts/1' }],
      },
    });

    const { pages } = renderDocument(d, 1);
    expect(pages).toEqual([
      { page: 1, markdown: 'Once upon a time.\n\n- First' },
    ]);
  });

  it('walks nested groups in reading order', () => {
    const d = doc({
      texts: [
        { self_ref: '#/texts/0', label: 'text', text: 'Inside a group', prov: [{ page_no: 1 }] },
      ],
      groups: [{ self_ref: '#/groups/0', children: [{ $ref: '#/texts/0' }] }],
      body: {
        self_ref: '#/body',
        children: [{ $ref: '#/groups/0' }],
      },
    });

    const { pages } = renderDocument(d, 1);
    expect(pages).toEqual([{ page: 1, markdown: 'Inside a group' }]);
  });

  it('renders a table as a GFM table', () => {
    const d = doc({
      tables: [
        {
          self_ref: '#/tables/0',
          label: 'table',
          prov: [{ page_no: 1 }],
          data: {
            num_rows: 2,
            num_cols: 2,
            table_cells: [
              { text: 'A', start_row_offset_idx: 0, start_col_offset_idx: 0 },
              { text: 'B', start_row_offset_idx: 0, start_col_offset_idx: 1 },
              { text: '1', start_row_offset_idx: 1, start_col_offset_idx: 0 },
              { text: '2', start_row_offset_idx: 1, start_col_offset_idx: 1 },
            ],
          },
        },
      ],
      body: { self_ref: '#/body', children: [{ $ref: '#/tables/0' }] },
    });

    const { pages } = renderDocument(d, 1);
    expect(pages[0].markdown).toBe(
      '| A | B |\n| --- | --- |\n| 1 | 2 |',
    );
  });

  it('skips page headers, footers, footnotes and pictures', () => {
    const d = doc({
      texts: [
        { self_ref: '#/texts/0', label: 'page_header', text: 'Running head', prov: [{ page_no: 1 }] },
        { self_ref: '#/texts/1', label: 'text', text: 'Real content', prov: [{ page_no: 1 }] },
        { self_ref: '#/texts/2', label: 'page_footer', text: '12', prov: [{ page_no: 1 }] },
        { self_ref: '#/texts/3', label: 'footnote', text: 'See note 1', prov: [{ page_no: 1 }] },
      ],
      pictures: [{ self_ref: '#/pictures/0' }],
      body: {
        self_ref: '#/body',
        children: [
          { $ref: '#/texts/0' },
          { $ref: '#/texts/1' },
          { $ref: '#/pictures/0' },
          { $ref: '#/texts/2' },
          { $ref: '#/texts/3' },
        ],
      },
    });

    const { pages } = renderDocument(d, 1);
    expect(pages).toEqual([{ page: 1, markdown: 'Real content' }]);
  });

  it('carries forward the last known page for an item with no provenance', () => {
    const d = doc({
      texts: [
        { self_ref: '#/texts/0', label: 'text', text: 'On page 2', prov: [{ page_no: 2 }] },
        { self_ref: '#/texts/1', label: 'text', text: 'No prov, stays on 2' },
      ],
      body: {
        self_ref: '#/body',
        children: [{ $ref: '#/texts/0' }, { $ref: '#/texts/1' }],
      },
    });

    const { pages } = renderDocument(d, 2);
    expect(pages).toEqual([
      { page: 1, markdown: '' },
      { page: 2, markdown: 'On page 2\n\nNo prov, stays on 2' },
    ]);
  });

  it('clamps a page number outside the known page range instead of dropping the content', () => {
    const d = doc({
      texts: [
        { self_ref: '#/texts/0', label: 'text', text: 'Reported as page 0', prov: [{ page_no: 0 }] },
        { self_ref: '#/texts/1', label: 'text', text: 'Reported past the end', prov: [{ page_no: 99 }] },
      ],
      body: {
        self_ref: '#/body',
        children: [{ $ref: '#/texts/0' }, { $ref: '#/texts/1' }],
      },
    });

    const { pages } = renderDocument(d, 2);
    expect(pages).toEqual([
      { page: 1, markdown: 'Reported as page 0' },
      { page: 2, markdown: 'Reported past the end' },
    ]);
  });

  it('produces an empty page entry for a page with no rendered content', () => {
    const d = doc({});
    const { pages, markdown } = renderDocument(d, 3);
    expect(pages).toEqual([
      { page: 1, markdown: '' },
      { page: 2, markdown: '' },
      { page: 3, markdown: '' },
    ]);
    expect(markdown).toBe(
      '<!-- page 1 -->\n\n\n<!-- page 2 -->\n\n\n<!-- page 3 -->\n',
    );
  });
});
