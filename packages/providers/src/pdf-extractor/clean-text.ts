import { decodeHTML } from 'entities';

// LlamaParse routinely emits inline presentational HTML inside heading text and
// page markdown - `<span style="color:#3d3b49">Level of Effort</span>`,
// `<b>`, `<br>`, stray HTML entities. Left alone it flows straight into chapter
// titles, chunk labels, retrieved passages and the synthesis prompt. These two
// pure helpers scrub it at the extractor boundary so everything downstream sees
// clean text.
//
//   - `cleanHeadingText`  - single-line titles: strip tags, decode entities,
//     drop invisible characters, collapse *all* whitespace, then unwrap a
//     Markdown emphasis pair only when it wraps the whole string.
//   - `cleanExtractedMarkdown` - body markdown: the same scrubbing applied
//     per line so Markdown structure (`#`, `-`, `|`, indentation) survives, and
//     `<br>` becomes a newline rather than a space. Emphasis is never touched.

// A real HTML/XML tag: `<` or `</` followed by a letter, up to the next `>`.
// Requiring a letter after `<` leaves prose like `a < b` untouched.
const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const BR_RE = /<br\s*\/?>/gi;

// Zero-width space / joiners, BOM & zero-width no-break space, soft hyphen.
const INVISIBLE_RE = /[\u200B-\u200D\uFEFF\u00AD]/g;
// C0/C1 control characters, keeping tab, newline and carriage return. The
// literal control ranges are the whole point here, hence the suppression.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

// Longest markers first so `***x***` unwraps in one step.
const EMPHASIS_WRAP_RE = /^(\*\*\*|\*\*|\*|___|__|_|`)([^\s]|[^\s].*[^\s])\1$/;

/**
 * Unwrap a single Markdown emphasis pair, but only when it encloses the entire
 * string and the inner text does not itself start or end with the same marker
 * (which would mean the markers were unbalanced). One level, one pass.
 */
function stripWrappingEmphasis(value: string): string {
  const match = EMPHASIS_WRAP_RE.exec(value);
  if (!match) return value;
  const markerChar = match[1][0];
  const inner = match[2];
  if (inner.startsWith(markerChar) || inner.endsWith(markerChar)) return value;
  return inner;
}

function stripTags(value: string): string {
  return value.replace(COMMENT_RE, '').replace(TAG_RE, '');
}

function stripInvisible(value: string): string {
  return value.replace(INVISIBLE_RE, '').replace(CONTROL_RE, '');
}

/**
 * Scrub a single-line heading / title string: inline HTML, entities, invisible
 * characters, whitespace runs, and a whole-string emphasis wrapper.
 */
export function cleanHeadingText(raw: string): string {
  const withoutBr = raw.replace(BR_RE, ' ');
  const decoded = decodeHTML(stripTags(withoutBr));
  const collapsed = stripInvisible(decoded).replace(/\s+/g, ' ').trim();
  return stripWrappingEmphasis(collapsed);
}

function cleanMarkdownLine(line: string): string {
  const decoded = decodeHTML(stripTags(line));
  const cleaned = stripInvisible(decoded);
  // Collapse runs of spaces/tabs and drop trailing ones, but keep the leading
  // indentation that Markdown uses for nested lists and fenced code.
  const leading = /^[ \t]*/.exec(cleaned)?.[0] ?? '';
  const rest = cleaned
    .slice(leading.length)
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+$/, '');
  return leading + rest;
}

/**
 * Scrub body markdown line by line: strips inline HTML and entities and
 * invisible characters, turns `<br>` into a newline, and preserves every
 * Markdown marker, blank line and leading indent. Emphasis is left intact.
 */
export function cleanExtractedMarkdown(raw: string): string {
  return raw
    .replace(COMMENT_RE, '')
    .replace(BR_RE, '\n')
    .split('\n')
    .map(cleanMarkdownLine)
    .join('\n');
}
