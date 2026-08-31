// THROWAWAY PROTOTYPE step 3 - compare retrieval strategies over the eval set.
// No labelled relevance judgments exist, so this reports what we CAN measure:
// similarity distribution, book/chapter spread, token load, and the raw picks to eyeball.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  embedQuestion,
  candidatePool,
  STRATEGIES,
  diversityStats,
} from './retrieve.mjs';

const questions = JSON.parse(readFileSync(join(import.meta.dirname, 'eval-questions.json'), 'utf8'));
const focus = process.argv[2]; // optional: only run one strategy, print full picks

for (const q of questions) {
  console.log('\n' + '='.repeat(100));
  console.log('Q: ' + q);
  const qvec = await embedQuestion(q);
  const poolRows = await candidatePool(qvec, { poolSize: 50 });
  console.log(
    `pool: 50 candidates, top sim ${poolRows[0].similarity.toFixed(3)}, ` +
    `#40 sim ${poolRows[39].similarity.toFixed(3)}, books in pool ${new Set(poolRows.map((r) => r.book_title)).size}`,
  );
  console.log('\nstrategy'.padEnd(24) + 'n  books  chaps  tokens   simMax  simMin');
  for (const [name, fn] of Object.entries(STRATEGIES)) {
    const sel = fn(poolRows);
    const s = diversityStats(sel);
    console.log(
      name.padEnd(24) +
        `${String(s.n).padStart(2)}  ${String(s.books).padStart(5)}  ${String(s.chapters).padStart(5)}  ` +
        `${String(s.tokens).padStart(6)}   ${s.simMax.toFixed(3)}   ${s.simMin.toFixed(3)}`,
    );
    if (focus && name === focus) {
      for (const c of sel) {
        console.log(
          `   [${c.similarity.toFixed(3)}] ${c.book_title} / ${c.chapter_title.slice(0, 40)}`,
        );
        console.log(`        ${c.chunk_text.slice(0, 140).replace(/\s+/g, ' ')}...`);
      }
    }
  }
}
