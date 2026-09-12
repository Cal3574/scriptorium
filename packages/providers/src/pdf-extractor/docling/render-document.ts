import type { PdfPage } from '../pdf-extractor.js';
import type {
  DoclingDocument,
  DoclingGroupItem,
  DoclingTableItem,
  DoclingTextItem,
} from './docling-document.js';

// Turns a docling `json_content` document into the same shape the rest of the
// pipeline already consumes: per-page markdown plus a single concatenated
// markdown string with `<!-- page N -->` sentinels (the same convention the
// old Gemini adapter used). `items` (chapter-detection's heading blocks) is
// deliberately not built here - `deriveHeadings` regexes it straight out of
// the `pages` this produces, the one source of truth for both.
//
// docling's `body` is a tree of `self_ref`/`$ref` pointers into `texts`,
// `groups`, `tables` and `pictures`; this walks it in reading order, resolving
// each ref and rendering the leaf to a markdown block. `page_header`,
// `page_footer`, `footnote` and picture items are dropped - they are furniture
// / non-body content, not part of the transcription.

const SKIP_TEXT_LABELS = new Set(['page_header', 'page_footer', 'footnote']);

interface RenderedLine {
  page: number | null;
  markdown: string;
}

function resolveRef(
  doc: DoclingDocument,
  ref: string,
):
  | { kind: 'texts'; item: DoclingTextItem }
  | { kind: 'groups'; item: DoclingGroupItem }
  | { kind: 'tables'; item: DoclingTableItem }
  | { kind: 'pictures' }
  | null {
  const match = /^#\/(texts|groups|tables|pictures)\/(\d+)$/.exec(ref);
  if (!match) return null;
  const index = Number(match[2]);
  switch (match[1]) {
    case 'texts':
      return doc.texts[index]
        ? { kind: 'texts', item: doc.texts[index] }
        : null;
    case 'groups':
      return doc.groups[index]
        ? { kind: 'groups', item: doc.groups[index] }
        : null;
    case 'tables':
      return doc.tables[index]
        ? { kind: 'tables', item: doc.tables[index] }
        : null;
    case 'pictures':
      return { kind: 'pictures' };
    default:
      return null;
  }
}

function headingPrefix(item: DoclingTextItem): string | null {
  if (item.label === 'title') return '# ';
  if (item.label === 'section_header') {
    const level = Math.min(Math.max(item.level ?? 1, 1) + 1, 6);
    return `${'#'.repeat(level)} `;
  }
  return null;
}

function renderText(item: DoclingTextItem): string {
  const prefix = headingPrefix(item);
  if (prefix) return prefix + item.text;
  if (item.label === 'list_item') return `- ${item.text}`;
  if (item.label === 'code') return `\`\`\`\n${item.text}\n\`\`\``;
  return item.text;
}

function tableCellText(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderTable(item: DoclingTableItem): string {
  const numRows = item.data?.num_rows ?? 0;
  const numCols = item.data?.num_cols ?? 0;
  if (numRows === 0 || numCols === 0) return '';

  const grid: string[][] = Array.from({ length: numRows }, () =>
    new Array(numCols).fill(''),
  );
  for (const cell of item.data?.table_cells ?? []) {
    const row = cell.start_row_offset_idx ?? 0;
    const col = cell.start_col_offset_idx ?? 0;
    if (row < numRows && col < numCols) {
      grid[row][col] = tableCellText(cell.text ?? '');
    }
  }

  const lines = [
    `| ${grid[0].join(' | ')} |`,
    `| ${grid[0].map(() => '---').join(' | ')} |`,
    ...grid.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}

function collectLines(
  doc: DoclingDocument,
  group: DoclingGroupItem,
  out: RenderedLine[],
): void {
  for (const ref of group.children) {
    const resolved = resolveRef(doc, ref.$ref);
    if (!resolved) continue;

    if (resolved.kind === 'groups') {
      collectLines(doc, resolved.item, out);
      continue;
    }
    if (resolved.kind === 'pictures') continue;

    if (resolved.kind === 'tables') {
      const markdown = renderTable(resolved.item);
      if (markdown.length > 0) {
        out.push({ page: resolved.item.prov?.[0]?.page_no ?? null, markdown });
      }
      continue;
    }

    const item = resolved.item;
    if (SKIP_TEXT_LABELS.has(item.label)) continue;
    const markdown = renderText(item);
    if (markdown.trim().length > 0) {
      out.push({ page: item.prov?.[0]?.page_no ?? null, markdown });
    }
  }
}

export function renderDocument(
  doc: DoclingDocument,
  pageCount: number,
): { pages: PdfPage[]; markdown: string } {
  const lines: RenderedLine[] = [];
  collectLines(doc, doc.body, lines);

  const buckets = new Map<number, string[]>();
  let currentPage = 1;
  for (const line of lines) {
    if (line.page !== null) {
      // Clamp rather than trust blindly: a `page_no` outside the pdfjs-derived
      // page count (a numbering mismatch, an off-by-one from docling) must not
      // silently drop content into a bucket the loop below never visits.
      currentPage = Math.min(Math.max(line.page, 1), pageCount);
    }
    const bucket = buckets.get(currentPage) ?? [];
    bucket.push(line.markdown);
    buckets.set(currentPage, bucket);
  }

  const pages: PdfPage[] = [];
  for (let page = 1; page <= pageCount; page++) {
    pages.push({ page, markdown: (buckets.get(page) ?? []).join('\n\n') });
  }

  const markdown = pages
    .map((page) => `<!-- page ${page.page} -->\n${page.markdown}\n`)
    .join('\n')
    .replace(/\n+$/, '\n');

  return { pages, markdown };
}
