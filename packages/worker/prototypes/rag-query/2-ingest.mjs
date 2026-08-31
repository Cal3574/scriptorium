// THROWAWAY PROTOTYPE step 2 - chunk, embed, persist to chunks.json.
// Each row mirrors the real denormalised `chunks` table (book/chapter fields,
// 1536-d vector). See lib.mjs for why this is a JSON file, not pgvector.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  splitChapters,
  chunkChapter,
  embedBatch,
  countTokens,
  saveStore,
  CONFIG,
  BOOKS_DIR,
} from './lib.mjs';

const manifest = JSON.parse(readFileSync(join(BOOKS_DIR, 'manifest.json'), 'utf8'));

const rows = [];
let chunkId = 0;
for (const book of manifest) {
  const raw = readFileSync(join(BOOKS_DIR, book.file), 'utf8');
  const chapters = splitChapters(raw);
  let bookChunkIdx = 0;
  for (const ch of chapters) {
    for (const text of chunkChapter(ch.text)) {
      rows.push({
        id: chunkId++,
        book_id: book.id,
        chapter_id: `${book.id}:${ch.index}`,
        book_title: book.title,
        book_author: book.author,
        chapter_title: ch.title,
        chapter_index: ch.index,
        chunk_index: bookChunkIdx++,
        chunk_text: text,
        token_count: countTokens(text),
      });
    }
  }
  console.log(
    `${book.title.padEnd(24)} ${String(chapters.length).padStart(3)} chapters  ${String(bookChunkIdx).padStart(4)} chunks`,
  );
}

console.log(`\nembedding ${rows.length} chunks via ${CONFIG.embeddingModel}...`);
const vectors = await embedBatch(rows.map((r) => r.chunk_text));
rows.forEach((r, i) => { r.embedding = vectors[i]; });

saveStore(rows);

const toks = rows.reduce((s, r) => s + r.token_count, 0);
const lens = rows.map((r) => r.token_count).sort((a, b) => a - b);
console.log(
  `\ndone. ${rows.length} chunks  median ${lens[lens.length >> 1]} tok  ` +
  `p95 ${lens[Math.floor(lens.length * 0.95)]} tok  max ${lens.at(-1)} tok`,
);
console.log(`embedding spend ~$${((toks / 1e6) * 0.02).toFixed(4)}  (wrote chunks.json)`);
