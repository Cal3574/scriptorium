#!/usr/bin/env node
/*
 * Regenerate a chapter-detection fixture from a real book.
 *
 *   node regen.mjs <source.pdf> <name>
 *
 * Steps:
 *   1. POST the PDF to LlamaParse v2 (`tier: cost_effective`), poll to SUCCESS,
 *      fetch `expand=markdown,items,metadata`.
 *   2. Run `pdfjs-dist` over the same file for the bookmark outline, resolving
 *      each destination to a 1-based page.
 *   3. Reduce both to the `DetectionInput` shape and write
 *      `packages/worker/src/ingest/chapter-detection/fixtures/<name>.detection-input.json`.
 *
 * You then hand-author `<name>.expected.json` (the chapters the detector should
 * return) by eyeballing the book's real table of contents.
 *
 * Requires `LLAMAPARSE_API_KEY` in the environment. This script is deliberately
 * kept out of the app build - it is a one-off capture tool that lives with the
 * prototype, not shipped code.
 *
 * The full *Pragmatic Programmer* capture is not committed: it needs the
 * licensed PDF. Run `node regen.mjs ~/books/pragmatic-programmer.pdf pragmatic-programmer`
 * once you have it, then author the expected file.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASE_URL = 'https://api.cloud.llamaindex.ai/api/v2';
const TIER = 'cost_effective';
const FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../../src/ingest/chapter-detection/fixtures',
);

const [, , pdfPath, name] = process.argv;
if (!pdfPath || !name) {
  console.error('usage: node regen.mjs <source.pdf> <name>');
  process.exit(1);
}
const apiKey = process.env.LLAMAPARSE_API_KEY;
if (!apiKey) {
  console.error('LLAMAPARSE_API_KEY is not set');
  process.exit(1);
}

const auth = { Authorization: `Bearer ${apiKey}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function llamaParse(bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), name);
  form.append('configuration', JSON.stringify({ tier: TIER }));
  const submit = await fetch(`${BASE_URL}/parse/upload`, {
    method: 'POST',
    headers: auth,
    body: form,
  });
  if (!submit.ok) throw new Error(`upload ${submit.status}`);
  const { id } = await submit.json();

  for (;;) {
    const poll = await fetch(`${BASE_URL}/parse/${id}`, { headers: auth });
    const { status } = await poll.json();
    if (status === 'SUCCESS' || status === 'PARTIAL_SUCCESS') break;
    if (!['PENDING', 'PROCESSING'].includes(status)) {
      throw new Error(`job ${id} ended ${status}`);
    }
    await sleep(2000);
  }

  const result = await fetch(
    `${BASE_URL}/parse/${id}?expand=markdown,items,metadata`,
    { headers: auth },
  );
  return result.json();
}

async function pdfOutline(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: true })
    .promise;
  const raw = (await doc.getOutline()) ?? [];

  const resolvePage = async (dest) => {
    try {
      const explicit =
        typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      const ref = Array.isArray(explicit) ? explicit[0] : null;
      if (!ref || typeof ref.num !== 'number') return null;
      return (await doc.getPageIndex(ref)) + 1;
    } catch {
      return null;
    }
  };

  const map = async (nodes) =>
    Promise.all(
      nodes.map(async (node) => ({
        title: (node.title ?? '').trim(),
        page: await resolvePage(node.dest),
        children: node.items?.length ? await map(node.items) : [],
      })),
    );

  const tree = await map(raw);
  await doc.destroy();
  return tree;
}

const bytes = new Uint8Array(await readFile(pdfPath));
const [parsed, outline] = await Promise.all([
  llamaParse(bytes),
  pdfOutline(bytes),
]);

const pages = (parsed.pages ?? []).map((p, i) => ({
  page: p.page ?? i + 1,
  markdown: (p.markdown ?? '').trim(),
}));
const items = (parsed.items ?? [])
  .filter((it) => it.type === 'heading')
  .map((it) => ({
    type: 'heading',
    level: it.lvl ?? it.level ?? 1,
    text: (it.value ?? it.content ?? it.text ?? '').trim(),
    page: it.page ?? it.page_number ?? 1,
  }))
  .filter((it) => it.text.length > 0);

const input = {
  pages,
  items,
  outline,
  metadata: {
    title: parsed.metadata?.title?.trim() ?? null,
    author: parsed.metadata?.author?.trim() ?? null,
  },
  pageCount:
    parsed.metadata?.page_count ??
    parsed.job_metadata?.page_count ??
    pages.length,
};

const out = resolve(FIXTURE_DIR, `${name}.detection-input.json`);
await writeFile(out, JSON.stringify(input, null, 2) + '\n');
console.log(`wrote ${out}`);
console.log(`now hand-author ${name}.expected.json`);
