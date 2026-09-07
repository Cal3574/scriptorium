// THROWAWAY - step 3: measure whole-book summary strategies + the chapter deep-dive.
// Spends real Claude credits (~$1 for the full run). Model = settled-stack claude-sonnet-5.
import Anthropic from '@anthropic-ai/sdk';
import { readCache, detectChapters, MODEL, dollars, ANTHROPIC_KEY } from './lib.mjs';

if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY missing');
const anthropic = new Anthropic();

const parse = readCache('parse.json');
if (!parse) throw new Error('run `node 1-parse.mjs` first');
const pages = parse.markdown.pages;
const fullText = pages.map((p) => p.markdown).join('\n\n');
const { markers } = detectChapters(parse);
const chapterText = (m) =>
  pages
    .filter((p) => p.page_number >= m.startPage && p.page_number <= m.endPage)
    .map((p) => p.markdown)
    .join('\n\n');

const runningCost = { total: 0 };
async function call(label, { system, user, maxTokens = 4000 }) {
  const t0 = Date.now();
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const cost = dollars(res.usage);
  runningCost.total += cost;
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  console.log(
    `\n[${label}] ${Math.round((Date.now() - t0) / 1000)}s  ` +
      `in=${res.usage.input_tokens} out=${res.usage.output_tokens}  $${cost.toFixed(4)}`,
  );
  return { text, usage: res.usage, cost };
}

// --- token budget --------------------------------------------------------
const count = await anthropic.messages.countTokens({
  model: MODEL,
  messages: [{ role: 'user', content: fullText }],
});
console.log(`\n=== TOKEN BUDGET ===`);
console.log(`full book markdown: ${count.input_tokens} tokens (${fullText.length} chars)`);
console.log(`fits 200K context: ${count.input_tokens < 190_000}   fits 1M context: ${count.input_tokens < 950_000}`);

const BOOK_SYS =
  'You are summarising a non-fiction book for a personal knowledge base. Produce a tight ' +
  'high-level summary: 1-paragraph thesis, then 5-9 bullet key ideas, then 3-5 bullets on ' +
  'how the ideas connect. Markdown. No preamble.';

// --- Strategy A: single-pass over the whole book -------------------------
const A = await call('A: single-pass whole book', {
  system: BOOK_SYS,
  user: `Summarise this entire book.\n\n<book>\n${fullText}\n</book>`,
});

// --- Strategy B: map-reduce over chapter summaries -----------------------
const CH_SYS =
  'You are writing a deep-dive summary of ONE chapter for a personal knowledge base. ' +
  'Output markdown: 2-3 sentence overview, then 4-8 key points with the author\'s reasoning, ' +
  'then any concrete practices/rules named. No preamble.';

console.log('\n--- Strategy B map step: per-chapter deep dives (concurrency 3) ---');
const mapResults = [];
for (let i = 0; i < markers.length; i += 3) {
  const batch = await Promise.all(
    markers.slice(i, i + 3).map((m) =>
      call(`  map ch ${m.num} (${m.title})`, {
        system: CH_SYS,
        user: `Chapter: ${m.title}\n\n${chapterText(m)}`,
      }).then((r) => ({ m, ...r })),
    ),
  );
  mapResults.push(...batch);
}
const mapTokens = mapResults.reduce(
  (a, r) => ({ in: a.in + r.usage.input_tokens, out: a.out + r.usage.output_tokens }),
  { in: 0, out: 0 },
);

const reduceInput = mapResults
  .map((r) => `## ${r.m.title}\n\n${r.text}`)
  .join('\n\n');
const B = await call('B: reduce step (book summary from chapter summaries)', {
  system: BOOK_SYS,
  user: `Here are per-chapter summaries of a book. Write the whole-book summary.\n\n${reduceInput}`,
});

// --- Chapter deep-dive: raw text vs chunks ------------------------------
console.log('\n=== CHAPTER DEEP-DIVE INPUT COMPARISON (chapter 3) ===');
const ch3 = markers.find((m) => m.num === '3');
const raw = chapterText(ch3);
// crude ~600-token paragraph-aligned chunks (matches map Notes chunking config)
const chunks = [];
let cur = '';
for (const para of raw.split(/\n\n+/)) {
  if ((cur + para).length > 2400 && cur) {
    chunks.push(cur.trim());
    cur = '';
  }
  cur += para + '\n\n';
}
if (cur.trim()) chunks.push(cur.trim());
console.log(`raw chapter: ${raw.length} chars   |   ${chunks.length} chunks (~600 tok each)`);
console.log('reassembled-from-chunks == raw:', chunks.join('\n\n').length, 'vs', raw.length);

// --- report ------------------------------------------------------------
console.log('\n=================== RESULTS ===================');
console.log(`Strategy A (single-pass): in=${A.usage.input_tokens} out=${A.usage.output_tokens}  $${A.cost.toFixed(4)}`);
console.log(
  `Strategy B (map-reduce):  map in=${mapTokens.in} out=${mapTokens.out}, ` +
    `reduce in=${B.usage.input_tokens} out=${B.usage.output_tokens}`,
);
const bCost = mapResults.reduce((a, r) => a + r.cost, 0) + B.cost;
console.log(`  B total ~$${bCost.toFixed(4)}   (A ~$${A.cost.toFixed(4)})`);
console.log(`\nNOTE: B also produces the ${markers.length} chapter deep-dives the product needs anyway.`);
console.log(`\ntotal spent this run: $${runningCost.total.toFixed(4)}`);

console.log('\n--- Strategy A summary ---\n' + A.text);
console.log('\n--- Strategy B summary ---\n' + B.text);
console.log('\n--- sample chapter deep-dive (ch 3, from map step) ---\n' + mapResults.find((r) => r.m.num === '3').text);
