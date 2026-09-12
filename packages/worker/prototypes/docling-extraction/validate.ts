/*
 * Pre-flip validation for the docling PDF extractor. See README.md.
 *
 *   node --import @swc-node/register/esm-register validate.ts <folder-of-pdfs>
 *
 * Deliberately kept out of the app build: it hits a real docling-serve
 * instance and real S3, and is a one-off measurement tool, not shipped code
 * or a CI test.
 */
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { DoclingPdfExtractor, S3ObjectStorage } from '@scriptorium/providers';
import {
  loadExtractionArtifact,
  type ExtractionArtifact,
} from '@scriptorium/server-core';
import { detectChapters } from '../../src/ingest/chapter-detection/detect-chapters.js';

const WITHIN = 0.1; // word-count ratio band for a "matching" page
const PASS_PAGE_SHARE = 0.95;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
  return value;
}

const doclingUrl = requiredEnv('DOCLING_URL');
const doclingApiKey = requiredEnv('DOCLING_API_KEY');
const s3Bucket = requiredEnv('S3_BUCKET');
const s3Region = requiredEnv('S3_REGION');
const awsAccessKeyId = requiredEnv('AWS_ACCESS_KEY_ID');
const awsSecretAccessKey = requiredEnv('AWS_SECRET_ACCESS_KEY');

const folder = process.argv[2];
if (!folder) {
  console.error('usage: validate.ts <folder-of-pdfs>');
  process.exit(1);
}

// manifest.json in the sample folder maps each local PDF filename to the
// original book's S3 key (`books/{userId}/{uuid}.pdf`). The baseline this
// compares against is that book's already-persisted Gemini extraction
// sidecar, not re-derived here - see README.md.
type Manifest = Record<string, string>;

async function loadManifest(): Promise<Manifest> {
  const path = join(folder, 'manifest.json');
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as Manifest;
  } catch {
    console.error(
      `${path} is required - map each PDF filename to its book's S3 key`,
    );
    process.exit(1);
  }
}

function numberEnv(name: string): number | undefined {
  const raw = process.env[name];
  return raw ? Number(raw) : undefined;
}

const manifest = await loadManifest();

const extractor = new DoclingPdfExtractor({
  baseUrl: doclingUrl,
  apiKey: doclingApiKey,
  documentTimeoutSeconds: numberEnv('DOCLING_DOCUMENT_TIMEOUT_SECONDS'),
});

const storage = new S3ObjectStorage({
  bucket: s3Bucket,
  region: s3Region,
  accessKeyId: awsAccessKeyId,
  secretAccessKey: awsSecretAccessKey,
});

const wordCount = (text: string): number =>
  text.trim() ? text.trim().split(/\s+/).length : 0;

// `books/{userId}/{uuid}.pdf` -> `books/{userId}/{uuid}.extraction.json`,
// same swap as `extractionArtifactKey` (kept here to avoid the full `BookRow`
// the shipped helper takes - this script only ever has the S3 key).
function extractionArtifactKeyFor(s3Key: string): string {
  const key = s3Key.replace(/\.pdf$/i, '.extraction.json');
  return key === s3Key ? `${s3Key}.extraction.json` : key;
}

async function loadBaseline(
  s3Key: string,
): Promise<ExtractionArtifact | null> {
  return loadExtractionArtifact(storage, extractionArtifactKeyFor(s3Key));
}

async function validateBook(path: string): Promise<void> {
  const name = basename(path, extname(path));
  const filename = basename(path);
  const s3Key = manifest[filename];
  if (!s3Key) {
    console.error(`\n=== ${name} === skipped: no manifest entry`);
    return;
  }

  const data = new Uint8Array(await readFile(path));

  console.log(`\n=== ${name} ===`);
  const [extraction, baseline] = await Promise.all([
    extractor.extract({ data, filename }),
    loadBaseline(s3Key),
  ]);

  if (!baseline) {
    console.error(`  no baseline extraction artifact at ${s3Key}`);
    return;
  }

  const lowRatioPages: number[] = [];
  let matching = 0;
  let missing = 0;
  let measured = 0;

  for (const page of extraction.pages) {
    const truth = wordCount(
      baseline.pages.find((p) => p.page === page.page)?.markdown ?? '',
    );
    if (truth === 0) continue;
    measured++;
    const got = wordCount(page.markdown);
    const ratio = got / truth;
    if (got === 0) missing++;
    if (ratio >= 1 - WITHIN && ratio <= 1 + WITHIN) matching++;
    else lowRatioPages.push(page.page);
  }
  const share = measured ? matching / measured : NaN;

  const [chapters, baselineChapters] = await Promise.all([
    detectChapters({
      pages: extraction.pages,
      items: extraction.items,
      outline: extraction.outline,
      metadata: extraction.metadata,
      pageCount: extraction.pageCount,
    }),
    detectChapters(baseline),
  ]);

  console.table({
    pages: extraction.pageCount,
    pagesWithin10pctOfBaseline: measured ? `${matching}/${measured}` : 'n/a',
    fullyMissingPages: missing,
    headings: extraction.items.length,
    baselineHeadings: baseline.items.length,
    detectedChapters: chapters.length,
    baselineChapters: baselineChapters.length,
    pageSharePass: measured ? share >= PASS_PAGE_SHARE : 'n/a',
  });

  console.log('docling chapters:');
  for (const c of chapters) {
    console.log(
      `  ${c.chapterIndex}. ${c.title ?? '(untitled)'} p${c.startPage}-${c.endPage}`,
    );
  }
  console.log('baseline (Gemini) chapters:');
  for (const c of baselineChapters) {
    console.log(
      `  ${c.chapterIndex}. ${c.title ?? '(untitled)'} p${c.startPage}-${c.endPage}`,
    );
  }

  if (lowRatioPages.length > 0) {
    console.log(
      `  ${lowRatioPages.length} page(s) diverge >10% from baseline word count: ${lowRatioPages.join(', ')}`,
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
