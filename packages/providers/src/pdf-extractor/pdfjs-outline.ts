import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfMetadata, PdfOutlineItem } from './pdf-extractor.js';

// The bookmark ("outline") tree is not something LlamaParse returns, so the
// live extractor runs a second, local pass over the same PDF bytes with
// `pdfjs-dist` purely to pull `getOutline()` and resolve each entry's
// destination to a 1-based page. Everything here is best-effort: any failure
// (an encrypted doc, a malformed dest, pdfjs throwing) resolves to an empty
// tree, because chapter detection treats the outline as corroboration only and
// has markdown-based fallbacks.

type GetDocument = (src: {
  data: Uint8Array;
  useSystemFonts?: boolean;
}) => PDFDocumentLoadingTask;

// The shape of one raw `getOutline()` node (pdfjs types this loosely).
interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineNode[];
}

async function loadGetDocument(): Promise<GetDocument | null> {
  try {
    // The legacy build is the one that runs under Node without a DOM.
    const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // Under Node there is no browser Worker, so pdfjs falls back to importing
    // its worker entry from `GlobalWorkerOptions.workerSrc` (default
    // `./pdf.worker.mjs`), which resolves relative to the *bundled* output and
    // is not there. Importing the worker module ourselves registers
    // `globalThis.pdfjsWorker`; pdfjs then runs the worker on the main thread
    // and never touches `workerSrc`. Fine for our one-shot structural pass.
    if (!(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker) {
      await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    }
    return (mod as { getDocument: GetDocument }).getDocument;
  } catch {
    return null;
  }
}

function isDestRef(value: unknown): value is { num: number; gen: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { num?: unknown }).num === 'number' &&
    typeof (value as { gen?: unknown }).gen === 'number'
  );
}

async function resolvePage(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null,
): Promise<number | null> {
  try {
    const explicit =
      typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const ref = explicit[0];
    if (!isDestRef(ref)) return null;
    const index = await doc.getPageIndex(ref);
    return index + 1;
  } catch {
    return null;
  }
}

async function mapNodes(
  doc: PDFDocumentProxy,
  nodes: OutlineNode[],
): Promise<PdfOutlineItem[]> {
  const out: PdfOutlineItem[] = [];
  for (const node of nodes) {
    const title = (node.title ?? '').trim();
    if (title.length === 0) continue;
    out.push({
      title,
      page: await resolvePage(doc, node.dest),
      children: node.items?.length ? await mapNodes(doc, node.items) : [],
    });
  }
  return out;
}

/**
 * Best-effort PDF bookmark outline, each entry's destination resolved to a
 * 1-based page. Returns `[]` on any failure.
 */
export async function extractPdfOutline(
  data: Uint8Array,
): Promise<PdfOutlineItem[]> {
  const getDocument = await loadGetDocument();
  if (!getDocument) return [];

  let task: PDFDocumentLoadingTask | null = null;
  try {
    // A fresh copy: pdfjs transfers/detaches the buffer it is handed.
    task = getDocument({ data: data.slice(), useSystemFonts: true });
    const doc = await task.promise;
    const outline = (await doc.getOutline()) as OutlineNode[] | null;
    if (!outline || outline.length === 0) return [];
    return await mapNodes(doc, outline);
  } catch {
    return [];
  } finally {
    await task?.destroy().catch(() => undefined);
  }
}

// The structural facts about a PDF that do not depend on the transcription
// provider: the bookmark outline, the document's own metadata, and the page
// count. The Gemini adapter needs all three - the outline and metadata as
// chapter-detection inputs (LlamaParse used to supply the metadata), the page
// count to compute batch ranges.
export interface PdfStructure {
  outline: PdfOutlineItem[];
  metadata: PdfMetadata;
  pageCount: number;
}

const EMPTY_METADATA: PdfMetadata = { title: null, author: null };

function cleanMetaString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Read the outline, metadata, and page count in one local `pdfjs-dist` pass.
 * The outline and metadata are best-effort (an unreadable dict yields `[]` /
 * nulls), but a document pdfjs cannot open at all - encrypted, truncated,
 * not a PDF - throws, because there is nothing to batch. The caller maps that
 * to a terminal extraction failure.
 */
export async function extractPdfStructure(
  data: Uint8Array,
): Promise<PdfStructure> {
  const getDocument = await loadGetDocument();
  if (!getDocument) {
    throw new Error('pdfjs-dist is unavailable; cannot read PDF structure');
  }

  let task: PDFDocumentLoadingTask | null = null;
  try {
    task = getDocument({ data: data.slice(), useSystemFonts: true });
    const doc = await task.promise;
    const pageCount = doc.numPages;

    let outline: PdfOutlineItem[] = [];
    try {
      const raw = (await doc.getOutline()) as OutlineNode[] | null;
      if (raw && raw.length > 0) outline = await mapNodes(doc, raw);
    } catch {
      outline = [];
    }

    let metadata: PdfMetadata = EMPTY_METADATA;
    try {
      const info = (await doc.getMetadata()).info as
        { Title?: unknown; Author?: unknown } | undefined;
      metadata = {
        title: cleanMetaString(info?.Title),
        author: cleanMetaString(info?.Author),
      };
    } catch {
      metadata = EMPTY_METADATA;
    }

    return { outline, metadata, pageCount };
  } finally {
    await task?.destroy().catch(() => undefined);
  }
}
