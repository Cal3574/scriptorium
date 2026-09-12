import { PdfExtractionError } from './pdf-extractor.js';
import { DoclingPdfExtractor } from './docling-pdf-extractor.js';
import type { PdfStructure } from './pdfjs-outline.js';
import type { DoclingDocument } from './docling/docling-document.js';

const structure: PdfStructure = {
  outline: [{ title: 'Chapter One', page: 1, children: [] }],
  metadata: { title: 'A Book', author: 'Someone' },
  pageCount: 2,
};

const document: DoclingDocument = {
  texts: [
    {
      self_ref: '#/texts/0',
      label: 'title',
      text: 'A Book',
      prov: [{ page_no: 1 }],
    },
    {
      self_ref: '#/texts/1',
      label: 'section_header',
      text: 'Chapter One',
      level: 1,
      prov: [{ page_no: 2 }],
    },
  ],
  groups: [],
  tables: [],
  pictures: [],
  body: {
    self_ref: '#/body',
    children: [{ $ref: '#/texts/0' }, { $ref: '#/texts/1' }],
  },
};

describe('DoclingPdfExtractor', () => {
  it('renders the docling document and derives headings from it', async () => {
    const extractor = new DoclingPdfExtractor({
      baseUrl: 'http://docling.local',
      readStructure: async () => structure,
      client: { convert: async () => document },
    });

    const result = await extractor.extract({
      data: new Uint8Array([1]),
      filename: 'book.pdf',
    });

    expect(result.pageCount).toBe(2);
    expect(result.outline).toEqual(structure.outline);
    expect(result.metadata).toEqual(structure.metadata);
    expect(result.pages).toEqual([
      { page: 1, markdown: '# A Book' },
      { page: 2, markdown: '## Chapter One' },
    ]);
    expect(result.items).toEqual([
      { type: 'heading', level: 1, text: 'A Book', page: 1 },
      { type: 'heading', level: 2, text: 'Chapter One', page: 2 },
    ]);
  });

  it('fails non-retryably when the PDF structure cannot be read', async () => {
    const extractor = new DoclingPdfExtractor({
      baseUrl: 'http://docling.local',
      readStructure: async () => {
        throw new Error('encrypted PDF');
      },
      client: { convert: async () => document },
    });

    await expect(
      extractor.extract({ data: new Uint8Array([1]), filename: 'book.pdf' }),
    ).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('encrypted PDF'),
    });
  });

  it('propagates a client conversion failure as-is', async () => {
    const failure = new PdfExtractionError('docling-serve unreachable', true);
    const extractor = new DoclingPdfExtractor({
      baseUrl: 'http://docling.local',
      readStructure: async () => structure,
      client: {
        convert: async () => {
          throw failure;
        },
      },
    });

    await expect(
      extractor.extract({ data: new Uint8Array([1]), filename: 'book.pdf' }),
    ).rejects.toBe(failure);
  });
});
