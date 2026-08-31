// THROWAWAY PROTOTYPE step 4 - the synthesis prompt + streamed Claude call.
// Validates: chunk formatting, [n] citation enforcement, "not enough context"
// behaviour, and the response contract (answer + citations + raw chunks).
import { anthropic, CONFIG, countTokens } from './lib.mjs';
import { embedQuestion, candidatePool, recommended, diversityStats } from './retrieve.mjs';

const SYSTEM = `You are a research assistant for a personal library. You answer the reader's
question by synthesising ONLY the numbered excerpts provided. The excerpts are passages
retrieved from books the reader has uploaded.

Rules:
- Use only information found in the excerpts. Never add outside knowledge or speculation.
- Every substantive claim must cite its source excerpt(s) with a bracketed marker like [3],
  or [2][5] for multiple. The marker is the excerpt number.
- When the excerpts genuinely do not contain enough information to answer, say so plainly
  in one or two sentences and stop. Do not pad, do not guess, do not apologise at length.
- Prefer synthesis across books over summarising one excerpt at a time. Draw out agreements,
  tensions, and connections between authors when the excerpts support it.
- Answer in concise markdown. No preamble like "Based on the excerpts".`;

function buildUserMessage(question, chunks, lowConfidence) {
  const excerpts = chunks
    .map((c, i) => `[${i + 1}] ${c.book_title} — ${c.chapter_title}\n${c.chunk_text}`)
    .join('\n\n');
  const note = lowConfidence
    ? '\n\nNote: retrieval returned weak matches for this question. If these excerpts ' +
      'do not actually address it, say the library does not seem to cover this.'
    : '';
  return `Question: ${question}${note}\n\nExcerpts:\n\n${excerpts}`;
}

const citedMarkers = (answer) => {
  const set = new Set();
  for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) set.add(Number(m[1]));
  return set;
};

async function runQuery(question, { bookId = null } = {}) {
  const qvec = await embedQuestion(question);
  const poolRows = await candidatePool(qvec, { poolSize: 50, bookId });
  const { chunks: selected, lowConfidence } = recommended(poolRows, {});

  // ---- citations event payload (fired before synthesis in the real API) ----
  const citations = selected.map((c, i) => ({
    marker: i + 1,
    chunkId: c.id,
    bookId: c.book_id,
    bookTitle: c.book_title,
    chapterTitle: c.chapter_title,
    chunkText: c.chunk_text,
  }));

  const userMsg = buildUserMessage(question, selected, lowConfidence);
  console.log('\n' + '#'.repeat(90));
  console.log('Q: ' + question);
  console.log('retrieval:', diversityStats(selected), 'lowConfidence:', lowConfidence, 'promptTokens~', countTokens(SYSTEM + userMsg));
  console.log('sources:');
  for (const c of citations) console.log(`  [${c.marker}] ${c.bookTitle} / ${c.chapterTitle.slice(0, 45)}  (sim ${selected[c.marker - 1].similarity.toFixed(3)})`);
  console.log('\n--- answer ---');

  let answer = '';
  const stream = await anthropic.messages.stream({
    model: CONFIG.synthesisModel,
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  });
  stream.on('text', (t) => { answer += t; process.stdout.write(t); });
  await stream.finalMessage();

  const used = citedMarkers(answer);
  const dangling = [...used].filter((m) => m < 1 || m > selected.length);
  const uncited = citations.filter((c) => !used.has(c.marker)).map((c) => c.marker);
  console.log('\n\n--- contract check ---');
  console.log('markers used:', [...used].sort((a, b) => a - b));
  console.log('dangling markers (out of range):', dangling);
  console.log('retrieved-but-uncited excerpt numbers:', uncited);
  console.log('answer chars:', answer.length);

  return { answer, citations, retrievedChunks: citations };
}

const q = process.argv.slice(2).join(' ');
const questions = q
  ? [q]
  : [
      'How do these authors think about acting well when you do not have complete information?',
      'What do these books say about the migratory patterns of the Arctic tern?',
    ];

for (const question of questions) await runQuery(question);
