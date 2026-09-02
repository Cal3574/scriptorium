import type { CountTokens } from './token-count.js';

// Paragraph-aligned token chunking. A chapter's text is split on blank lines
// into paragraphs; paragraphs are packed greedily up to ~`targetTokens`, and
// each new chunk is seeded with the trailing paragraphs of the previous one
// totalling ~`overlapTokens` so retrieval keeps context across a boundary. A
// single paragraph larger than the target is sentence-split as a last resort;
// nothing smaller than a sentence is ever cut.

export interface ChunkTextOptions {
  targetTokens?: number;
  overlapTokens?: number;
  countTokens: CountTokens;
}

export interface TextChunk {
  text: string;
  tokenCount: number;
}

const DEFAULT_TARGET = 600;
const DEFAULT_OVERLAP = 80;

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function splitSentences(paragraph: string): string[] {
  const parts = paragraph.match(/[^.!?]+[.!?]+(?:["')\]]+)?\s*|[^.!?]+$/g);
  return (parts ?? [paragraph])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Break a too-large paragraph into sub-paragraph units no bigger than the
// target, preferring sentence boundaries.
function fitUnits(
  paragraph: string,
  targetTokens: number,
  countTokens: CountTokens,
): string[] {
  if (countTokens(paragraph) <= targetTokens) return [paragraph];
  const sentences = splitSentences(paragraph);
  const units: string[] = [];
  let current: string[] = [];
  for (const sentence of sentences) {
    const candidate = [...current, sentence].join(' ');
    if (current.length > 0 && countTokens(candidate) > targetTokens) {
      units.push(current.join(' '));
      current = [sentence];
    } else {
      current.push(sentence);
    }
  }
  if (current.length > 0) units.push(current.join(' '));
  return units;
}

// The trailing units of a just-emitted chunk that add up to ~overlapTokens,
// kept whole. Never returns the entire chunk (that would make no forward
// progress).
function overlapUnits(
  units: string[],
  overlapTokens: number,
  countTokens: CountTokens,
): string[] {
  if (overlapTokens <= 0 || units.length <= 1) return [];
  const kept: string[] = [];
  let total = 0;
  for (let i = units.length - 1; i > 0; i--) {
    kept.unshift(units[i]);
    total += countTokens(units[i]);
    if (total >= overlapTokens) break;
  }
  return kept;
}

export function chunkText(
  text: string,
  options: ChunkTextOptions,
): TextChunk[] {
  const targetTokens = options.targetTokens ?? DEFAULT_TARGET;
  const overlapTokens = options.overlapTokens ?? DEFAULT_OVERLAP;
  const { countTokens } = options;

  const units = splitParagraphs(text).flatMap((p) =>
    fitUnits(p, targetTokens, countTokens),
  );
  if (units.length === 0) return [];

  const chunks: TextChunk[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const body = current.join('\n\n');
    chunks.push({ text: body, tokenCount: countTokens(body) });
    current = overlapUnits(current, overlapTokens, countTokens);
  };

  for (const unit of units) {
    const candidate = [...current, unit].join('\n\n');
    if (current.length > 0 && countTokens(candidate) > targetTokens) {
      flush();
    }
    current.push(unit);
  }
  flush();

  // The overlap seed can leave a final chunk that is nothing but the tail of
  // its predecessor - drop it.
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    if (prev.text.includes(last.text)) chunks.pop();
  }

  return chunks;
}
