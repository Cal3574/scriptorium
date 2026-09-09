import * as pdfjs from 'pdfjs-dist';
// Vite compiles the pdf.js worker to a chunk served from our own origin. It
// must not come from a CDN - the app's CSP would block that - and the worker
// keeps the parse off the main thread so the deposit slip stays responsive.
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

export interface PdfPreview {
  pageCount: number;
  // A `data:` URL of the first page, rendered small for the deposit slip.
  // Self-contained, so there is no object URL to revoke.
  thumbnailUrl: string;
}

// Roughly 2x the slip's cover slot, for crisp rendering on retina displays.
const THUMBNAIL_WIDTH = 240;

// Read a picked PDF locally: its page count and a first-page thumbnail, for
// the deposit slip. Rejects on a corrupt, empty, or password-protected file
// (pdf.js throws) - the slip treats that as "couldn't read this PDF" and
// blocks the deposit. The server pipeline is still the authoritative check.
export async function renderPdfPreview(file: File): Promise<PdfPreview> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: THUMBNAIL_WIDTH / base.width,
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const canvasContext = canvas.getContext('2d');
    if (!canvasContext) throw new Error('no 2d context for pdf thumbnail');

    await page.render({ canvas, canvasContext, viewport }).promise;

    return {
      pageCount: doc.numPages,
      thumbnailUrl: canvas.toDataURL('image/png'),
    };
  } finally {
    void task.destroy();
  }
}
