import { EMBEDDING_DIMENSIONS } from './embedding-client.js';
import { FakeEmbeddingClient } from './fake-embedding-client.js';

const dot = (a: number[], b: number[]): number =>
  a.reduce((sum, ai, i) => sum + ai * b[i], 0);
const norm = (a: number[]): number => Math.sqrt(dot(a, a));

describe('FakeEmbeddingClient', () => {
  const client = new FakeEmbeddingClient();

  it('returns one L2-normalised 1536-d vector per input', async () => {
    const [vec] = await client.embed(['atomic habits']);
    expect(vec).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(norm(vec)).toBeCloseTo(1, 6);
  });

  it('returns [] for an empty batch', async () => {
    expect(await client.embed([])).toEqual([]);
  });

  it('is deterministic - the same text always embeds identically', async () => {
    const [a] = await client.embed(['the plateau of latent potential']);
    const [b] = await new FakeEmbeddingClient().embed([
      'the plateau of latent potential',
    ]);
    expect(a).toEqual(b);
  });

  it('gives different texts different vectors', async () => {
    const [a, b] = await client.embed(['starting small', 'keeping the thread']);
    expect(a).not.toEqual(b);
  });

  it('has a stable cosine ordering across runs', async () => {
    const query = 'how do habits form';
    const corpus = [
      'cue routine reward loop',
      'compound interest of small wins',
      'the shape of a cue',
      'unrelated text about naval strategy',
    ];

    const rank = async (): Promise<string[]> => {
      const c = new FakeEmbeddingClient();
      const [q] = await c.embed([query]);
      const vecs = await c.embed(corpus);
      // vectors are unit-length, so dot product == cosine similarity
      return corpus
        .map((text, i) => ({ text, sim: dot(q, vecs[i]) }))
        .sort((x, y) => y.sim - x.sim)
        .map((r) => r.text);
    };

    expect(await rank()).toEqual(await rank());
  });
});
