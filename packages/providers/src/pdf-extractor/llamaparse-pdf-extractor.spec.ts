import { LlamaParseExtractor } from './llamaparse-pdf-extractor.js';

// Drives the adapter through its three-request lifecycle (upload -> status ->
// result) against a stubbed `fetch`, and asserts that the LlamaParse HTML noise
// is scrubbed out by the time it reaches `PdfExtraction`.

const JOB_ID = 'job-123';

interface StubResult {
  markdown?: unknown;
  items?: unknown;
  metadata?: unknown;
}

function stubFetch(result: StubResult): jest.Mock {
  return jest.fn(async (url: string | URL) => {
    const href = url.toString();
    if (href.endsWith('/parse/upload')) {
      return new Response(JSON.stringify({ id: JOB_ID, status: 'PENDING' }), {
        status: 200,
      });
    }
    if (href.includes('expand=')) {
      return new Response(JSON.stringify(result), { status: 200 });
    }
    return new Response(
      JSON.stringify({ job: { id: JOB_ID, status: 'COMPLETED' } }),
      { status: 200 },
    );
  }) as jest.Mock;
}

describe('LlamaParseExtractor text cleaning', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const extractor = new LlamaParseExtractor({
    apiKey: 'test-key',
    baseUrl: 'https://llama.test/api/v2',
  });
  const input = { data: new Uint8Array([1, 2, 3]), filename: 'book.pdf' };

  it('strips inline HTML from headings, page markdown and metadata', async () => {
    global.fetch = stubFetch({
      markdown: {
        pages: [
          {
            page_number: 1,
            markdown:
              '## <span style="color:#3d3b49">Chapter 1. Level of Effort</span>\n\nWork with <b>Katas</b> &amp; repeat.',
          },
        ],
      },
      items: {
        pages: [
          {
            page_number: 1,
            items: [
              {
                type: 'heading',
                level: 2,
                value:
                  '<span style="color:#3d3b49">Chapter 1. Level of Effort</span>',
              },
            ],
          },
        ],
      },
      metadata: {
        document: {
          title: '<span>The Pragmatic Programmer</span>',
          author: 'Hunt &amp; Thomas',
        },
      },
    });

    const extraction = await extractor.extract(input);

    expect(extraction.items).toEqual([
      {
        type: 'heading',
        level: 2,
        text: 'Chapter 1. Level of Effort',
        page: 1,
      },
    ]);
    expect(extraction.pages[0].markdown).toBe(
      '## Chapter 1. Level of Effort\n\nWork with Katas & repeat.',
    );
    expect(extraction.markdown).not.toContain('<span');
    expect(extraction.metadata).toEqual({
      title: 'The Pragmatic Programmer',
      author: 'Hunt & Thomas',
    });
  });
});
