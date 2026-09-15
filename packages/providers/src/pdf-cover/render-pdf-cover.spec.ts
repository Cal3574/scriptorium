import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { renderPdfCover } from './render-pdf-cover.js';

// A real, valid single-page PDF, built with `pdf-lib` (not a hand-rolled or
// FakePdfExtractor-style byte string) so this test exercises the actual
// pdfjs-dist parse + @napi-rs/canvas rasterise path the worker's cover
// backfill runs in production, end to end.
async function samplePdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 450]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Deep Work', {
    x: 40,
    y: 400,
    size: 24,
    font,
    color: rgb(0, 0, 0),
  });
  return doc.save();
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('renderPdfCover', () => {
  it('renders the first page as a PNG data URL', async () => {
    const pdf = await samplePdfBytes();

    const { dataUrl } = await renderPdfCover(pdf);

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    const png = Buffer.from(dataUrl.split(',')[1], 'base64');
    expect(png.subarray(0, PNG_MAGIC.length)).toEqual(PNG_MAGIC);
  });

  it('renders at the documented cover width, scaled from the page aspect ratio', async () => {
    // 300x450 (2:3, a typical book-page ratio) at the 240px cover width scales
    // to a 240x360 raster.
    const pdf = await samplePdfBytes();

    const { dataUrl } = await renderPdfCover(pdf);

    const png = Buffer.from(dataUrl.split(',')[1], 'base64');
    // PNG IHDR: width and height are the 4-byte big-endian fields immediately
    // after the 8-byte magic + 4-byte length + 4-byte "IHDR" chunk type.
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(240);
    expect(height).toBe(360);
  });

  it('rejects bytes that are not a valid PDF', async () => {
    await expect(
      renderPdfCover(Buffer.from('not a pdf', 'utf-8')),
    ).rejects.toThrow();
  });

  it('accepts a Node Buffer, not only a plain Uint8Array', async () => {
    // pdf.js rejects a `Buffer` outright ("Please provide binary data as
    // Uint8Array, rather than Buffer"), and every real caller - object
    // storage adapters, `fs.readFile` - is liable to hand us one.
    const pdf = Buffer.from(await samplePdfBytes());
    expect(Buffer.isBuffer(pdf)).toBe(true);

    const { dataUrl } = await renderPdfCover(pdf);

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
