/*
 * Pre-flip validation for the Gemini PDF extractor. See README.md.
 *
 *   node --import @swc-node/register/esm-register validate.ts <folder-of-pdfs>
 *
 * Deliberately kept out of the app build: it makes real, paid Gemini calls and
 * is a one-off measurement tool, not shipped code or a CI test.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { GeminiPdfExtractor, type PdfExtraction } from '@scriptorium/providers';
import { detectChapters } from '../../src/ingest/chapter-detection/detect-chapters.js';

const WITHIN = 0.1; // word-count ratio band for a "matching" page
const PASS_PAGE_SHARE = 0.95;

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set');
  process.exit(1);
}

const folder = process.argv[2];
if (!folder) {
  console.error('usage: validate.ts <folder-of-pdfs>');
  process.exit(1);
}

const outDir = resolve(import.meta.dirname, 'out');

const extractor = new GeminiPdfExtractor({
  apiKey,
  model: process.env.GEMINI_MODEL,
  pagesPerBatch: numberEnv('GEMINI_PAGES_PER_BATCH'),
  batchConcurrency: numberEnv('GEMINI_BATCH_CONCURRENCY'),
  emitEvent: (event) => console.log('  [event]', JSON.stringify(event)),
});

function numberEnv(name: string): number | undefined {
  const raw = process.env[name];
  return raw ? Number(raw) : undefined;
}

const wordCount = (text: string): number =>
  text.trim() ? text.trim().split(/\s+/).length : 0;

// A per-page raw text layer via pdfjs, the ground truth Gemini is measured
// against. Empty for a scanned/image-only PDF.
async function pdfjsPageText(data: Uint8Array): Promise<string[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: data.slice(), useSystemFonts: true })
    .promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(
      (content.items as Array<{ str?: string }>)
        .map((item) => item.str ?? '')
        .join(' '),
    );
  }
  await doc.destroy();
  return pages;
}

function placeholderCount(extraction: PdfExtraction): number {
  return extraction.pages.filter((p) =>
    /transcription unavailable/i.test(p.markdown),
  ).length;
}

async function validateBook(path: string): Promise<void> {
  const name = basename(path, extname(path));
  const data = new Uint8Array(await readFile(path));

  console.log(`\n=== ${name} ===`);
  const [extraction, groundTruth] = await Promise.all([
    extractor.extract({ data, filename: basename(path) }),
    pdfjsPageText(data).catch(() => [] as string[]),
  ]);

  const bornDigital = groundTruth.some((t) => wordCount(t) > 0);
  const lowRatioPages: number[] = [];
  let matching = 0;
  let missing = 0;

  for (const page of extraction.pages) {
    const truth = wordCount(groundTruth[page.page - 1] ?? '');
    if (truth === 0) continue;
    const got = wordCount(page.markdown);
    const ratio = got / truth;
    if (got === 0) missing++;
    if (ratio >= 1 - WITHIN && ratio <= 1 + WITHIN) matching++;
    else lowRatioPages.push(page.page);
  }

  const measured = bornDigital
    ? groundTruth.filter((t) => wordCount(t) > 0).length
    : 0;
  const share = measured ? matching / measured : NaN;

  const chapters = await detectChapters({
    pages: extraction.pages,
    items: extraction.items,
    outline: extraction.outline,
    metadata: extraction.metadata,
    pageCount: extraction.pageCount,
  });

  const toc = await readFile(join(folder, `${name}.toc.txt`), 'utf-8').catch(
    () => null,
  );

  console.table({
    pages: extraction.pageCount,
    bornDigital,
    pagesWithin10pct: measured ? `${matching}/${measured}` : 'n/a (scanned)',
    fullyMissingPages: missing,
    headings: extraction.items.length,
    placeholders: placeholderCount(extraction),
    detectedChapters: chapters.length,
    pageSharePass: bornDigital ? share >= PASS_PAGE_SHARE : 'eyeball',
  });

  console.log('detected chapters:');
  for (const c of chapters) {
    console.log(
      `  ${c.chapterIndex}. ${c.title ?? '(untitled)'} p${c.startPage}-${c.endPage}`,
    );
  }
  if (toc) {
    console.log('book TOC:');
    for (const line of toc.split('\n').filter(Boolean))
      console.log(`  ${line}`);
  }

  if (lowRatioPages.length > 0) {
    const bookOut = join(outDir, name);
    await mkdir(bookOut, { recursive: true });
    for (const p of lowRatioPages) {
      const page = extraction.pages.find((pg) => pg.page === p);
      await writeFile(join(bookOut, `page-${p}.md`), page?.markdown ?? '');
    }
    console.log(
      `  dumped ${lowRatioPages.length} low-ratio page(s) to ${bookOut}`,
    );
  }
}

const entries = (await readdir(folder)).filter(
  (f) => extname(f).toLowerCase() === '.pdf',
);
if (entries.length === 0) {
  console.error(`no PDFs in ${folder}`);
  process.exit(1);
}

for (const entry of entries) {
  await validateBook(join(folder, entry)).catch((error) => {
    console.error(
      `  FAILED: ${error instanceof Error ? error.message : error}`,
    );
  });
}
