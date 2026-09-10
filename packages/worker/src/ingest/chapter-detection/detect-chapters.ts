import type {
  PdfHeadingItem,
  PdfMetadata,
  PdfOutlineItem,
  PdfPage,
} from '@scriptorium/providers';
import { pageRangeMarkdown } from '@scriptorium/server-core';

// Pure chapter detection. Given the LlamaParse result (per-page markdown, the
// `items` heading blocks, the metadata) and the `pdfjs-dist` bookmark outline,
// it returns ordered chapters with page ranges. It never touches the network
// or the database; the one impure hook is `resolveGapTitle`, an optional cheap
// LLM call used only to name a synthesised gap chapter.
//
// The strategy, in order:
//   1. Find "markers" - `##`-agnostic heading blocks that read like
//      "Chapter 7. Title" - filtering out TOC lines and front matter.
//   2. With >= 2 markers: corroborate their pages against the outline, then
//      fill every gap in the `1..max` chapter-number run with a synthesised
//      chapter.
//   3. With < 2 markers: use the outline as the chapter list.
//   4. With neither: the largest cluster of same-size headings, else the whole
//      book as a single chapter (never fatal).

export interface DetectedChapter {
  title: string | null;
  chapterIndex: number;
  startPage: number;
  endPage: number;
}

export interface DetectionInput {
  pages: PdfPage[];
  items: PdfHeadingItem[];
  outline: PdfOutlineItem[];
  metadata: PdfMetadata;
  pageCount: number;
}

export interface DetectionOptions {
  // Names a synthesised gap chapter when the outline has nothing to offer.
  // Return null to fall back to `Chapter N`. Given the gap's chapter number
  // and the text of its page range.
  resolveGapTitle?: (ctx: {
    chapterNumber: number;
    text: string;
  }) => Promise<string | null>;
}

// A heading block that reads like a chapter start.
const MARKER_RE =
  /^(chapter|appendix|part)\s+(\d{1,2}|[A-Z]|[IVXLC]{1,5})[.:]?\s+(.+)$/i;

// Front-matter headings that must never be treated as chapters.
const FRONT_MATTER_RE =
  /^(contents|copyright|dedication|foreword|preface|acknowledge?ments?|about the authors?|introduction)\b/i;

// A trailing page number, optionally behind a dot leader - the tell of a TOC
// line masquerading as a heading.
const TRAILING_PAGE_NO_RE = /(?:\.{2,}\s*|\s{2,})\d{1,4}\s*$/;

// A table-of-contents line: some text, then a dot leader or a wide gap, then a
// page number.
const TOC_LINE_RE = /\S(?:\s*\.{2,}\s*|\s{2,})\d{1,4}\s*$/;
const SHORT_LINE_MAX = 60;
// A `MARKER_RE` hit is a strong enough signal that a longer line is still a
// chapter opening (some chapter titles run past `SHORT_LINE_MAX`); only a truly
// paragraph-length line is rejected.
const MARKER_LINE_MAX = 100;

// The arabic chapter number a marker's second capture group denotes, or null
// for lettered / roman / appendix / part markers (per the spec, only arabic
// `chapter` numbers join the `1..max` gap-fill run).
function arabicNumber(kind: string, token: string): number | null {
  if (kind.toLowerCase() !== 'chapter') return null;
  return /^\d{1,2}$/.test(token) ? Number(token) : null;
}

interface Marker {
  title: string;
  page: number;
  number: number | null;
}

function normaliseTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// True when two headings plausibly name the same thing: after normalisation
// one contains the other. Used for dedupe, outline corroboration and gap-title
// lookup alike.
function titlesOverlap(a: string, b: string): boolean {
  const na = normaliseTitle(a);
  const nb = normaliseTitle(b);
  if (na.length === 0 || nb.length === 0) return false;
  return na.includes(nb) || nb.includes(na);
}

// The 1-based pages that look like a table of contents: inside the leading
// window and carrying at least three short "…\t42" lines.
function findTocPages(pages: PdfPage[], pageCount: number): Set<number> {
  const windowSize = Math.max(20, Math.ceil(pageCount * 0.1));
  const toc = new Set<number>();
  for (const { page, markdown } of pages) {
    if (page > windowSize) continue;
    let hits = 0;
    for (const rawLine of markdown.split('\n')) {
      const line = rawLine.trim();
      if (line.length === 0 || line.length > SHORT_LINE_MAX) continue;
      if (TOC_LINE_RE.test(line)) hits++;
    }
    if (hits >= 3) toc.add(page);
  }
  return toc;
}

function collectMarkers(
  items: PdfHeadingItem[],
  tocPages: Set<number>,
): Marker[] {
  const markers: Marker[] = [];
  for (const item of items) {
    if (item.type !== 'heading') continue;
    const text = item.text.trim();
    if (text.length > MARKER_LINE_MAX) continue;
    if (tocPages.has(item.page)) continue;
    if (TRAILING_PAGE_NO_RE.test(text)) continue;
    // Only a standalone front-matter heading is excluded here - a real
    // chapter whose title merely starts with "Introduction" (e.g.
    // "Chapter 1. Introduction to Testing") stays a chapter.
    if (FRONT_MATTER_RE.test(text)) continue;
    const match = MARKER_RE.exec(text);
    if (!match) continue;
    const [, kind, token] = match;
    // Collapse a `#`/`##` pair LlamaParse emitted for the same chapter opening:
    // same page, and one heading's text is contained in the other's. Two
    // genuinely different chapters that happen to share a page are kept.
    const duplicate = markers.find(
      (m) => m.page === item.page && titlesOverlap(m.title, text),
    );
    if (duplicate) continue;
    markers.push({
      title: text,
      page: item.page,
      number: arabicNumber(kind, token),
    });
  }
  return dedupeMarkers(trimRecapTail(markers.sort((a, b) => a.page - b.page)));
}

// A book's real chapters climb monotonically in both number and page. Back
// matter that recaps them - a "Discussion Questions" section, a per-chapter
// index - repeats the whole "Chapter 1..N" list while the page keeps rising, so
// the number resets. Once a numbered marker drops well below the highest number
// already seen, treat it and everything after it as recap and drop it. The
// tolerance keeps a lone out-of-order heading (a forward reference parsed as a
// heading) from truncating a real chapter list.
const RECAP_NUMBER_DROP = 2;

function trimRecapTail(markers: Marker[]): Marker[] {
  let maxNumber = 0;
  for (let i = 0; i < markers.length; i++) {
    const n = markers[i].number;
    if (n == null) continue;
    if (n <= maxNumber - RECAP_NUMBER_DROP) return markers.slice(0, i);
    maxNumber = Math.max(maxNumber, n);
  }
  return markers;
}

// Drop a marker named the same as one already kept: a chapter opening echoed by
// a running header, or a part divider both mentioned in chapter 1's roadmap and
// printed on its own divider page. For numbered markers the earliest page wins
// (that is the real opening); for unnumbered ones the latest page wins (the
// divider itself, not the forward reference).
function dedupeMarkers(markers: Marker[]): Marker[] {
  const kept: Marker[] = [];
  for (const marker of markers) {
    const dupIndex = kept.findIndex(
      (m) =>
        (m.number != null && m.number === marker.number) ||
        ((m.number == null) === (marker.number == null) &&
          titlesOverlap(m.title, marker.title)),
    );
    if (dupIndex === -1) {
      kept.push(marker);
      continue;
    }
    if (marker.number == null && kept[dupIndex].page < marker.page) {
      kept[dupIndex] = marker;
    }
  }
  return kept;
}

function flattenOutline(nodes: PdfOutlineItem[]): PdfOutlineItem[] {
  const flat: PdfOutlineItem[] = [];
  for (const node of nodes) {
    flat.push(node);
    if (node.children.length > 0) flat.push(...flattenOutline(node.children));
  }
  return flat;
}

// Match a marker to an outline entry by normalised-title containment, and if
// the outline's page is more than 2 away from the marker's, trust the outline.
// Only an *unambiguous* match counts: a chapter title like "Chapter 27. The
// Laws of Software Architecture, Revisited" also contains an unrelated section
// bookmark ("Laws of Software Architecture"), so when more than one outline
// entry overlaps we keep the marker's own page rather than jump to the wrong
// one.
function corroboratePages(
  markers: Marker[],
  outline: PdfOutlineItem[],
): Marker[] {
  const entries = flattenOutline(outline).filter(
    (node): node is PdfOutlineItem & { page: number } => node.page != null,
  );
  if (entries.length === 0) return markers;

  return markers.map((marker) => {
    const hits = entries.filter((entry) =>
      titlesOverlap(marker.title, entry.title),
    );
    if (hits.length !== 1) return marker;
    const hit = hits[0];
    return Math.abs(hit.page - marker.page) <= 2
      ? marker
      : { ...marker, page: hit.page };
  });
}

// The 1-based page the book's body starts on: the first page after any leading
// run of TOC / empty pages.
function firstBodyPage(pages: PdfPage[], tocPages: Set<number>): number {
  for (const { page, markdown } of pages) {
    if (tocPages.has(page)) continue;
    if (markdown.trim().length === 0) continue;
    return page;
  }
  return 1;
}

interface WorkingChapter {
  title: string | null;
  page: number;
  number: number | null;
  synthesised: boolean;
}

// Expand a marker list into the full `1..max` numbered run, synthesising a
// placeholder for every missing number. Non-numbered markers (appendix, part)
// are appended in page order.
function withGapChapters(
  markers: Marker[],
  bodyPage: number,
  pageCount: number,
): WorkingChapter[] {
  const numbered = markers
    .filter((m): m is Marker & { number: number } => m.number != null)
    .sort((a, b) => a.number - b.number);
  const others = markers.filter((m) => m.number == null);

  if (numbered.length === 0) {
    return markers
      .map((m) => ({
        title: m.title,
        page: m.page,
        number: null,
        synthesised: false,
      }))
      .sort((a, b) => a.page - b.page);
  }

  const maxNumber = numbered[numbered.length - 1].number;
  // First (earliest-page) marker wins a repeated chapter number: the real
  // opening sits ahead of any later echo of it.
  const byNumber = new Map<number, Marker & { number: number }>();
  for (const marker of numbered) {
    if (!byNumber.has(marker.number)) byNumber.set(marker.number, marker);
  }
  const run: WorkingChapter[] = [];

  for (let n = 1; n <= maxNumber; n++) {
    const real = byNumber.get(n);
    if (real) {
      run.push({
        title: real.title,
        page: real.page,
        number: n,
        synthesised: false,
      });
      continue;
    }
    run.push({
      title: null,
      page: interpolatePage(numbered, n, bodyPage, pageCount),
      number: n,
      synthesised: true,
    });
  }

  const appended = others
    .map((m) => ({
      title: m.title,
      page: m.page,
      number: null,
      synthesised: false,
    }))
    .sort((a, b) => a.page - b.page);

  return [...run, ...appended];
}

// A monotonic page estimate for a missing chapter number, linearly between the
// nearest present numbers on either side (or the body start / last page at the
// ends).
function interpolatePage(
  numbered: Array<Marker & { number: number }>,
  target: number,
  bodyPage: number,
  pageCount: number,
): number {
  const lower = [...numbered].reverse().find((m) => m.number < target);
  const upper = numbered.find((m) => m.number > target);

  if (lower && upper) {
    const span = upper.number - lower.number;
    const ratio = (target - lower.number) / span;
    return Math.max(
      lower.page,
      Math.round(lower.page + (upper.page - lower.page) * ratio),
    );
  }
  if (!lower && upper) return bodyPage;
  if (lower && !upper) return Math.min(pageCount, lower.page + 1);
  return bodyPage;
}

function toDetected(
  working: WorkingChapter[],
  pageCount: number,
  firstPage: number,
): DetectedChapter[] {
  const ordered = [...working].sort((a, b) => a.page - b.page);
  return ordered.map((chapter, index) => {
    const isLast = index === ordered.length - 1;
    // Only a *synthesised* opening chapter is stretched back to swallow the
    // front matter; a real "Chapter 1" marker keeps its own page so the TOC
    // and title pages stay out of its chunks.
    const rawStart =
      index === 0 && chapter.synthesised
        ? Math.min(chapter.page, firstPage)
        : chapter.page;
    const startPage = Math.max(1, rawStart);
    const endPage = isLast
      ? Math.max(startPage, pageCount)
      : Math.max(startPage, ordered[index + 1].page - 1);
    return {
      title: chapter.title,
      chapterIndex: index,
      startPage,
      endPage,
    };
  });
}

function largestSameLevelCluster(
  items: PdfHeadingItem[],
  tocPages: Set<number>,
): PdfHeadingItem[] {
  const eligible = items.filter(
    (item) =>
      !tocPages.has(item.page) &&
      !FRONT_MATTER_RE.test(item.text.trim()) &&
      item.text.trim().length <= SHORT_LINE_MAX,
  );
  const byLevel = new Map<number, PdfHeadingItem[]>();
  for (const item of eligible) {
    const bucket = byLevel.get(item.level) ?? [];
    bucket.push(item);
    byLevel.set(item.level, bucket);
  }
  let best: PdfHeadingItem[] = [];
  for (const bucket of byLevel.values()) {
    if (bucket.length > best.length) best = bucket;
  }
  return best.length >= 2 ? best.sort((a, b) => a.page - b.page) : [];
}

export async function detectChapters(
  input: DetectionInput,
  options: DetectionOptions = {},
): Promise<DetectedChapter[]> {
  const pageCount = Math.max(input.pageCount, 1);
  const pages = [...input.pages].sort((a, b) => a.page - b.page);
  const tocPages = findTocPages(pages, pageCount);
  const bodyPage = firstBodyPage(pages, tocPages);

  const markers = corroboratePages(
    collectMarkers(input.items, tocPages),
    input.outline,
  );

  // Path 1: enough markers to trust the markdown structure.
  if (markers.length >= 2) {
    const working = withGapChapters(markers, bodyPage, pageCount);
    const detected = toDetected(working, pageCount, bodyPage);
    return fillGapTitles(detected, working, pages, input.outline, options);
  }

  // Path 2: the outline carries the chapter list.
  const outlineChapters = flattenTopLevelOutline(input.outline);
  if (outlineChapters.length >= 1) {
    const working: WorkingChapter[] = outlineChapters.map((node) => ({
      title: node.title,
      page: node.page ?? bodyPage,
      number: null,
      synthesised: false,
    }));
    return toDetected(working, pageCount, bodyPage);
  }

  // Path 3: the largest cluster of same-size headings.
  const cluster = largestSameLevelCluster(input.items, tocPages);
  if (cluster.length >= 2) {
    const working: WorkingChapter[] = cluster.map((item) => ({
      title: item.text.trim(),
      page: item.page,
      number: null,
      synthesised: false,
    }));
    return toDetected(working, pageCount, bodyPage);
  }

  // Path 4: whole book as one chapter. Never fatal.
  return [
    {
      title: input.metadata.title,
      chapterIndex: 0,
      startPage: 1,
      endPage: pageCount,
    },
  ];
}

function flattenTopLevelOutline(
  outline: PdfOutlineItem[],
): Array<{ title: string; page: number | null }> {
  return outline
    .filter((node) => node.title.trim().length > 0)
    .filter((node) => !FRONT_MATTER_RE.test(node.title.trim()))
    .map((node) => ({ title: node.title.trim(), page: node.page }));
}

async function fillGapTitles(
  detected: DetectedChapter[],
  working: WorkingChapter[],
  pages: PdfPage[],
  outline: PdfOutlineItem[],
  options: DetectionOptions,
): Promise<DetectedChapter[]> {
  const outlineEntries = flattenOutline(outline).filter(
    (node): node is PdfOutlineItem & { page: number } => node.page != null,
  );

  const result: DetectedChapter[] = [];
  for (let i = 0; i < detected.length; i++) {
    const chapter = detected[i];
    const source = working.slice().sort((a, b) => a.page - b.page)[i];
    if (chapter.title != null || !source?.synthesised) {
      result.push(chapter);
      continue;
    }

    const chapterNumber = source.number ?? i + 1;
    const prevEnd = result[result.length - 1]?.endPage ?? 0;
    const nextStart = detected[i + 1]?.startPage ?? Number.MAX_SAFE_INTEGER;

    // (a) the outline. Prefer an entry that names this exact chapter number
    // ("21. Architectural Decisions") sitting anywhere between the previous and
    // next chapter - the numbered outline nodes are the real chapter list and
    // the interpolated page can be well off. Otherwise take the first entry
    // inside the interpolated range.
    // Lower bound is the previous chapter's *start*, not its end: a one-page
    // part divider ahead of this gap can carry an end page that runs past where
    // this chapter's own content (and its outline node) begins.
    const prevStart = detected[i - 1]?.startPage ?? 0;
    const numberedRe = new RegExp(`^${chapterNumber}[.:]\\s`);
    const byNumber = outlineEntries.find(
      (entry) =>
        numberedRe.test(entry.title.trim()) &&
        entry.page > prevStart &&
        entry.page < nextStart,
    );
    const inRange = outlineEntries.find(
      (entry) =>
        entry.page >= chapter.startPage && entry.page <= chapter.endPage,
    );
    const fromOutline = byNumber ?? inRange;
    if (fromOutline) {
      // Pull the start back to the numbered outline page when doing so does not
      // collide with the previous chapter.
      const startPage =
        fromOutline.page > prevEnd && fromOutline.page < chapter.startPage
          ? fromOutline.page
          : chapter.startPage;
      result.push({ ...chapter, title: fromOutline.title, startPage });
      continue;
    }

    // (b) a cheap LLM call.
    if (options.resolveGapTitle) {
      const text = pageRangeMarkdown(pages, chapter.startPage, chapter.endPage);
      const llmTitle = await options.resolveGapTitle({ chapterNumber, text });
      if (llmTitle && llmTitle.trim().length > 0) {
        result.push({ ...chapter, title: llmTitle.trim() });
        continue;
      }
    }

    // (c) the bare fallback.
    result.push({ ...chapter, title: `Chapter ${chapterNumber}` });
  }
  return result;
}
