import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingClient,
} from '@scriptorium/providers';
import type { BookRow } from '@scriptorium/server-core';
import { embedStage } from './embed.stage.js';
import type { StageDeps, StageLogger } from '../stage.js';

const silentLogger: StageLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const book = { id: 'book-1' } as BookRow;
const vec = () => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01);

function makeDeps(chunkCount: number) {
  const embedded = new Map<string, number[]>();
  const chunks = Array.from({ length: chunkCount }, (_, i) => ({
    id: `c${i}`,
    text: `chunk ${i}`,
  }));
  const embed = jest.fn((texts: string[]) =>
    Promise.resolve(texts.map(() => vec())),
  );
  const embeddings = { embed } as unknown as EmbeddingClient;
  const progress: Array<{ done: number; total: number; unit: string }> = [];
  const repo = {
    chunkEmbeddingCounts: jest.fn(() =>
      Promise.resolve({
        total: chunkCount,
        unembedded: chunks.length - embedded.size,
      }),
    ),
    listUnembeddedChunks: jest.fn(() =>
      Promise.resolve(chunks.filter((c) => !embedded.has(c.id))),
    ),
    writeChunkEmbeddings: jest.fn(
      (rows: { id: string; embedding: number[] }[]) => {
        for (const r of rows) embedded.set(r.id, r.embedding);
        return Promise.resolve();
      },
    ),
  };
  const events = {
    stageProgress: jest.fn(
      (
        _id: string,
        _stage: string,
        p: { done: number; total: number; unit: string },
      ) => {
        progress.push(p);
        return Promise.resolve();
      },
    ),
  };
  const deps = {
    repo,
    embeddings,
    events,
    logger: silentLogger,
  } as unknown as StageDeps;
  return { deps, embed, repo, events, progress, embedded };
}

describe('embedStage', () => {
  it('is complete only when the book has chunks and none are unembedded', async () => {
    const { deps, repo } = makeDeps(3);
    expect(await embedStage.isComplete(book, deps)).toBe(false);

    (repo.chunkEmbeddingCounts as jest.Mock).mockResolvedValueOnce({
      total: 0,
      unembedded: 0,
    });
    expect(await embedStage.isComplete(book, deps)).toBe(false);

    (repo.chunkEmbeddingCounts as jest.Mock).mockResolvedValueOnce({
      total: 3,
      unembedded: 0,
    });
    expect(await embedStage.isComplete(book, deps)).toBe(true);
  });

  it('embeds every chunk in batches of 128 and writes each batch back', async () => {
    const { deps, embed, repo, progress } = makeDeps(300);

    await embedStage.run(book, deps);

    // 300 chunks -> batches of 128, 128, 44.
    expect(
      embed.mock.calls.map(([texts]) => texts.length).sort((a, b) => a - b),
    ).toEqual([44, 128, 128]);
    expect(repo.writeChunkEmbeddings).toHaveBeenCalledTimes(3);
    expect(progress.at(-1)).toEqual({ done: 300, total: 300, unit: 'chunks' });
  });

  it('only embeds the chunks still missing a vector on a resumed run', async () => {
    const { deps, embed, embedded } = makeDeps(10);
    embedded.set('c0', vec());
    embedded.set('c1', vec());

    await embedStage.run(book, deps);

    const seen = embed.mock.calls.flatMap(([texts]) => texts);
    expect(seen).toHaveLength(8);
    expect(seen).not.toContain('chunk 0');
  });

  it('throws when the client returns the wrong vector width', async () => {
    const { deps, embed } = makeDeps(2);
    embed.mockResolvedValueOnce([
      [1, 2, 3],
      [1, 2, 3],
    ]);
    await expect(embedStage.run(book, deps)).rejects.toThrow(/expected 1536/);
  });
});
