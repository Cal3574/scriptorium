// THROWAWAY PROTOTYPE - shared helpers for wayfinder ticket #11.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { encode } from 'gpt-tokenizer';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

// ---- config knobs the prototype exists to tune -------------------------------
export const CONFIG = {
  // chunking (mirrors the map's settled ~600 token / ~80 overlap, paragraph-aligned)
  chunkTargetTokens: 600,
  chunkOverlapTokens: 80,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: 1536,
  synthesisModel: 'claude-sonnet-5',
};

// ---- clients ----------------------------------------------------------------
export const openai = new OpenAI({ apiKey: process.env.OPEN_AI_API_KEY });
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The real system uses pgvector + an HNSW cosine index. The Docker registry is
// unreachable in this environment, so the prototype keeps the embedded corpus in
// a JSON file and does brute-force cosine in JS. That is exact (full recall) and
// fast at this corpus size (a few thousand chunks); what it deliberately does NOT
// measure is HNSW recall/latency or `hnsw.ef_search` - those move to a build-time
// tuning task. Retrieval STRATEGY (top-k, threshold, de-dup, MMR, prompt) is
// unaffected by the index and is what this prototype tunes.
export const STORE_PATH = join(__dirname, 'chunks.json');
export const loadStore = () => JSON.parse(readFileSync(STORE_PATH, 'utf8'));
export const saveStore = (rows) => writeFileSync(STORE_PATH, JSON.stringify(rows));

// ---- tokens ---------------------------------------------------------------
export const countTokens = (text) => encode(text).length;

// ---- chunking -----------------------------------------------------------------
// Splits a Gutenberg-style plain-text book into chapters, then each chapter into
// paragraph-aligned ~targetTokens windows with ~overlapTokens of carry-over.
const CHAPTER_RE =
  /^\s{0,4}(chapter\s+[ivxlcdm\d]+|book\s+[ivxlcdm\d]+|part\s+[ivxlcdm\d]+)\b.*$/i;

export function splitChapters(raw) {
  const lines = raw.split(/\r?\n/);
  const chapters = [];
  let current = { title: 'Front Matter', index: 0, lines: [] };
  for (const line of lines) {
    if (CHAPTER_RE.test(line)) {
      if (current.lines.some((l) => l.trim())) chapters.push(current);
      current = {
        title: line.trim().replace(/\s+/g, ' '),
        index: chapters.length,
        lines: [],
      };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.trim())) chapters.push(current);
  // drop a leading front-matter block that is mostly boilerplate
  return chapters
    .map((c) => ({ ...c, text: c.lines.join('\n').trim() }))
    .filter((c) => countTokens(c.text) > 50)
    .map((c, i) => ({ ...c, index: i }));
}

export function chunkChapter(chapterText) {
  const paragraphs = chapterText
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const chunks = [];
  let buf = [];
  let bufTokens = 0;

  const flush = () => {
    if (!buf.length) return;
    chunks.push(buf.join('\n\n'));
    // carry the tail paragraphs worth ~overlapTokens into the next window
    let carry = [];
    let carryTokens = 0;
    for (let i = buf.length - 1; i >= 0; i--) {
      const t = countTokens(buf[i]);
      if (carryTokens + t > CONFIG.chunkOverlapTokens) break;
      carry.unshift(buf[i]);
      carryTokens += t;
    }
    buf = carry;
    bufTokens = carryTokens;
  };

  for (const p of paragraphs) {
    const t = countTokens(p);
    if (t > CONFIG.chunkTargetTokens * 1.5) {
      // a monster paragraph - hard-split on sentences
      flush();
      const sentences = p.match(/[^.!?]+[.!?]+|\S+$/g) || [p];
      let sb = [];
      let sbt = 0;
      for (const s of sentences) {
        const st = countTokens(s);
        if (sbt + st > CONFIG.chunkTargetTokens && sb.length) {
          chunks.push(sb.join(' ').trim());
          sb = [];
          sbt = 0;
        }
        sb.push(s);
        sbt += st;
      }
      if (sb.length) chunks.push(sb.join(' ').trim());
      continue;
    }
    if (bufTokens + t > CONFIG.chunkTargetTokens && buf.length) flush();
    buf.push(p);
    bufTokens += t;
  }
  flush();
  return chunks.filter((c) => countTokens(c) > 20);
}

// ---- embeddings -------------------------------------------------------------
export async function embedBatch(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 128) {
    const slice = texts.slice(i, i + 128);
    const res = await openai.embeddings.create({
      model: CONFIG.embeddingModel,
      input: slice,
      dimensions: CONFIG.embeddingDimensions,
    });
    out.push(...res.data.map((d) => d.embedding));
    process.stdout.write(`  embedded ${Math.min(i + 128, texts.length)}/${texts.length}\r`);
  }
  process.stdout.write('\n');
  return out;
}

export const toVectorLiteral = (arr) => `[${arr.join(',')}]`;

export function loadJson(name) {
  return JSON.parse(readFileSync(join(__dirname, name), 'utf8'));
}

export const BOOKS_DIR = join(__dirname, 'books');
