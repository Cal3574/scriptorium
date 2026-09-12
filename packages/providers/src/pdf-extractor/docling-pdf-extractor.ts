import { deriveHeadings } from './derive-headings.js';
import {
  PdfExtractionError,
  type PdfExtractInput,
  type PdfExtraction,
  type PdfExtractor,
} from './pdf-extractor.js';
import { extractPdfStructure, type PdfStructure } from './pdfjs-outline.js';
import { DoclingClient, type DoclingClientOptions } from './docling/docling-client.js';
import { renderDocument } from './docling/render-document.js';

export interface DoclingPdfExtractorOptions extends DoclingClientOptions {
  // Seams for tests: an injectable structural pass and a fake client so an
  // adapter spec needs no real PDF or network.
  readStructure?: (data: Uint8Array) => Promise<PdfStructure>;
  client?: Pick<DoclingClient, 'convert'>;
}

/**
 * A PDF text extractor backed by a self-hosted docling-serve instance. A
 * local `pdfjs-dist` pass supplies the outline, metadata, and page count (as
 * for the retired Gemini adapter); the whole PDF is then sent to docling-serve
 * as one async conversion job (there is nothing to fan out to on a single VPS
 * instance), and its `json_content` is walked into markdown, per-page
 * markdown, and heading blocks by `renderDocument` / `deriveHeadings`.
 * Implements the same {@link PdfExtractor} seam as the adapters it replaces,
 * so everything downstream is unchanged.
 */
export class DoclingPdfExtractor implements PdfExtractor {
  private readonly client: Pick<DoclingClient, 'convert'>;
  private readonly readStructure: (data: Uint8Array) => Promise<PdfStructure>;

  constructor(options: DoclingPdfExtractorOptions) {
    this.client = options.client ?? new DoclingClient(options);
    this.readStructure = options.readStructure ?? extractPdfStructure;
  }

  async extract(input: PdfExtractInput): Promise<PdfExtraction> {
    const structure = await this.readCanonicalStructure(input);
    const document = await this.client.convert(input.data, input.filename);
    const { pages, markdown } = renderDocument(document, structure.pageCount);

    return {
      markdown,
      pages,
      items: deriveHeadings(pages),
      outline: structure.outline,
      metadata: structure.metadata,
      pageCount: structure.pageCount,
    };
  }

  private async readCanonicalStructure(
    input: PdfExtractInput,
  ): Promise<PdfStructure> {
    try {
      const structure = await this.readStructure(input.data);
      if (structure.pageCount < 1) {
        throw new Error('PDF reported zero pages');
      }
      return structure;
    } catch (error) {
      // A PDF we cannot even open the structure of is not going to convert;
      // fail the book rather than retry a hopeless job.
      throw new PdfExtractionError(
        `Could not read PDF structure for ${input.filename}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        false,
        { cause: error },
      );
    }
  }
}
