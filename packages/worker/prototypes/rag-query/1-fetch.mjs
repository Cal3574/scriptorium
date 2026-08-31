// THROWAWAY PROTOTYPE step 1 - fetch public-domain books to chunk & embed.
// Four texts with deliberate thematic overlap (thinking / method / strategy) so
// cross-book synthesis queries have something real to synthesise.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BOOKS_DIR } from './lib.mjs';

const BOOKS = [
  { id: 'how-we-think', title: 'How We Think', author: 'John Dewey', gutenberg: 37423 },
  { id: 'thinking-as-a-science', title: 'Thinking as a Science', author: 'Henry Hazlitt', gutenberg: 18887 },
  { id: 'the-art-of-war', title: 'The Art of War', author: 'Sun Tzu', gutenberg: 132 },
  { id: 'the-prince', title: 'The Prince', author: 'Niccolo Machiavelli', gutenberg: 1232 },
];

function stripGutenberg(text) {
  let body = text;
  const s = body.match(/\*\*\*\s*START OF TH[EIS][^*]*\*\*\*/s);
  if (s) body = body.slice(s.index + s[0].length);
  const e = body.match(/\*\*\*\s*END OF TH[EIS][^*]*\*\*\*/s);
  if (e) body = body.slice(0, e.index);
  return body.trim();
}

mkdirSync(BOOKS_DIR, { recursive: true });

const manifest = [];
for (const book of BOOKS) {
  const dest = join(BOOKS_DIR, `${book.id}.txt`);
  if (!existsSync(dest)) {
    const url = `https://www.gutenberg.org/cache/epub/${book.gutenberg}/pg${book.gutenberg}.txt`;
    process.stdout.write(`fetching ${book.title}... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const raw = await res.text();
    writeFileSync(dest, stripGutenberg(raw));
    console.log('ok');
  } else {
    console.log(`${book.title} already present`);
  }
  manifest.push({ ...book, file: `${book.id}.txt` });
}

writeFileSync(join(BOOKS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nwrote ${manifest.length} books + manifest.json`);
