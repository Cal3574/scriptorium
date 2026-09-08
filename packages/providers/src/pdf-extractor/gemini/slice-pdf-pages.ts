import { PDFDocument } from 'pdf-lib';

// Cut a contiguous 1-based inclusive page range out of a PDF into a new,
// standalone PDF, using `pdf-lib` (pure JS, no native bindings). The Gemini
// adapter sends these slices inline as native PDF bytes - one request per
// batch - so a single call never approaches Gemini's 1000-page / 50MB cap.

export async function slicePdfPages(
  data: Uint8Array,
  startPage: number,
  endPage: number,
): Promise<Uint8Array> {
  // pdf-lib detaches nothing, but pdfjs elsewhere does; hand it a copy so the
  // two structural passes over the same bytes stay independent.
  const source = await PDFDocument.load(data.slice(), {
    ignoreEncryption: true,
  });
  const total = source.getPageCount();
  const from = Math.max(1, startPage);
  const to = Math.min(total, endPage);

  const out = await PDFDocument.create();
  const indices: number[] = [];
  for (let page = from; page <= to; page++) indices.push(page - 1);
  const copied = await out.copyPages(source, indices);
  for (const page of copied) out.addPage(page);
  return out.save();
}
