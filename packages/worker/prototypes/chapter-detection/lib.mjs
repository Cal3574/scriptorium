// THROWAWAY - shared helpers for wayfinder ticket #7 prototype.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CACHE = path.join(HERE, '.cache');
export const PDF_PATH = path.resolve(
  HERE,
  '../../../../mock-data/The_Pragmatic_Programmer.pdf',
);

// --- env -------------------------------------------------------------------
function loadEnv() {
  for (const candidate of [
    path.join(HERE, '.env'),
    path.resolve(HERE, '../../.env'), // packages/worker/.env
  ]) {
    if (!fs.existsSync(candidate)) continue;
    for (const line of fs.readFileSync(candidate, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

export const LLAMA_KEY = process.env.LLAMA_CLOUD_API_KEY;
export const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// --- LlamaParse v2 --------------------------------------------------------
const LLAMA_BASE = 'https://api.cloud.llamaindex.ai/api/v2';

// Cost-effective tier per LlamaParse research (issue #5). `configuration` is a
// JSON string part alongside the binary `file` part; `version` is required.
export async function llamaSubmit(pdfPath, config = {}) {
  const buf = fs.readFileSync(pdfPath);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'application/pdf' }), path.basename(pdfPath));
  form.append(
    'configuration',
    JSON.stringify({ tier: 'cost_effective', version: 'latest', ...config }),
  );
  const res = await fetch(`${LLAMA_BASE}/parse/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${LLAMA_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`);
  return res.json();
}

const DONE = ['COMPLETED', 'SUCCESS', 'PARTIAL_SUCCESS'];
const DEAD = ['FAILED', 'ERROR', 'CANCELLED', 'TIMEOUT'];

export async function llamaPoll(jobId, { intervalMs = 10_000, timeoutMs = 40 * 60_000 } = {}) {
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${LLAMA_BASE}/parse/${jobId}`, {
      headers: { Authorization: `Bearer ${LLAMA_KEY}` },
    });
    if (!res.ok) throw new Error(`status ${res.status}: ${await res.text()}`);
    const body = await res.json();
    const job = body.job ?? body;
    const status = job.status ?? job.job_status;
    process.stdout.write(`  [${Math.round((Date.now() - start) / 1000)}s] ${status}\n`);
    if (DONE.includes(status)) return job;
    if (DEAD.includes(status)) throw new Error(`job ${status}: ${JSON.stringify(body)}`);
    if (Date.now() - start > timeoutMs) throw new Error('poll timeout');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Results come from the same job endpoint via ?expand=markdown,items,metadata
export async function llamaResult(jobId) {
  const res = await fetch(`${LLAMA_BASE}/parse/${jobId}?expand=markdown,items,metadata`, {
    headers: { Authorization: `Bearer ${LLAMA_KEY}` },
  });
  if (!res.ok) throw new Error(`result ${res.status}: ${await res.text()}`);
  return res.json();
}

// --- cache ---------------------------------------------------------------
export function readCache(name) {
  const p = path.join(CACHE, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
export function writeCache(name, data) {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, name), JSON.stringify(data, null, 2));
}

// --- chapter detection heuristic ---------------------------------------
// Operates on the cached LlamaParse `parse.json` -> `.items.pages[].items[]`.
// Finding from the prototype run: heading LEVELS (#/##) are assigned per-page by
// visual size and are NOT document structure - "Andrew Hunt" is an h1, so are
// half the section titles. The reliable signal is the "Chapter N." / "Appendix X."
// TITLE TEXT, on a heading/text block, not on a contents page.
const CHAPTER_RE = /^(chapter|appendix|part)\s+(\d{1,2}|[A-Z]|[IVXLC]{1,5})[.:]?\s+(.+)/i;
// "Chapter 3. The Basic Tools 72" or "...Paranoia..........100" -> a TOC line
const TRAILING_PAGE_RE = /(\s+|\.{2,}\s*)\d{1,4}\s*$/;
const FRONT_MATTER = /^(contents|table of contents|copyright|dedication|foreword|preface|acknowledge?ments?|about the authors?|introduction)\b/i;

export function flattenItems(parse) {
  const out = [];
  for (const page of parse.items?.pages ?? []) {
    for (const it of page.items ?? []) {
      const raw = it.value ?? it.md ?? '';
      out.push({
        page: page.page_number,
        type: it.type,
        text: raw.replace(/^#+\s*/, '').replace(/<[^>]+>/g, '').trim(),
        mdLevel: headingLevelFromMd(it.md),
      });
    }
  }
  return out;
}

// pages that hold the printed table of contents: early in the book, dense with
// heading-ish lines that carry a trailing page number.
function tocPages(items, pageCount) {
  const cutoff = Math.max(20, Math.ceil(pageCount * 0.1));
  const trailingByPage = new Map();
  for (const it of items) {
    if (it.page > cutoff) continue;
    if (TRAILING_PAGE_RE.test(it.text) && it.text.length < 90) {
      trailingByPage.set(it.page, (trailingByPage.get(it.page) ?? 0) + 1);
    }
  }
  return new Set([...trailingByPage].filter(([, n]) => n >= 3).map(([p]) => p));
}

export function detectChapters(parse) {
  const items = flattenItems(parse);
  const pageCount = parse.metadata?.pages?.length ?? Math.max(...items.map((i) => i.page));
  const toc = tocPages(items, pageCount);

  const markers = [];
  const seen = new Set();
  for (const it of items) {
    if (toc.has(it.page)) continue;
    if (TRAILING_PAGE_RE.test(it.text)) continue;
    if (it.type !== 'heading') continue; // heading blocks are the only trustworthy source
    if (it.text.length > 60) continue; // a real chapter title is short; a sentence is not
    const m = it.text.match(CHAPTER_RE);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    const num = m[2];
    const title = m[3].trim();
    const key = `${kind}:${num}`;
    if (seen.has(key)) continue; // de-dupe running headers / repeats
    seen.add(key);
    markers.push({ kind, num, title, page: it.page, blockType: it.type, rawText: it.text });
  }

  // Gap detection: numbered chapters should run 1..N with no holes.
  const nums = markers
    .filter((m) => m.kind === 'chapter' && /^\d+$/.test(m.num))
    .map((m) => Number(m.num));
  const gaps = [];
  if (nums.length) {
    for (let n = 1; n <= Math.max(...nums); n++) {
      if (!nums.includes(n)) gaps.push(n);
    }
  }

  // front matter = everything of substance before the first marker
  const firstMarkerPage = markers[0]?.page ?? pageCount;
  const frontMatterHeadings = items.filter(
    (it) => it.page < firstMarkerPage && it.type === 'heading' && FRONT_MATTER.test(it.text),
  );

  // page ranges from consecutive markers (issue #5: LlamaParse has no range field)
  for (let i = 0; i < markers.length; i++) {
    markers[i].startPage = markers[i].page;
    markers[i].endPage = markers[i + 1] ? markers[i + 1].page - 1 : pageCount;
  }

  return { pageCount, tocPages: [...toc], markers, gaps, frontMatterHeadings };
}

function headingLevelFromMd(md) {
  if (!md) return null;
  const m = md.match(/^(#+)\s/);
  return m ? m[1].length : null;
}

// --- anthropic -----------------------------------------------------------
// Uses the settled-stack model (map Notes): claude-sonnet-5.
export const MODEL = 'claude-sonnet-5';
// Sonnet 5 pricing $/1M (claude-api skill cache 2026-06-24)
export const PRICE = { in: 2.0, out: 10.0 };

export function dollars(usage) {
  return (
    (usage.input_tokens * PRICE.in +
      (usage.cache_read_input_tokens ?? 0) * PRICE.in * 0.1 +
      (usage.cache_creation_input_tokens ?? 0) * PRICE.in * 1.25 +
      usage.output_tokens * PRICE.out) /
    1_000_000
  );
}
