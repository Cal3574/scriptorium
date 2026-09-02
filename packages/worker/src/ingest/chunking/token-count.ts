import { encode } from 'gpt-tokenizer';

// A token counter. The chunker takes this as a parameter so tests can inject a
// cheap deterministic stand-in; production uses the real BPE encoder that
// matches the OpenAI embedding model the chunks are sized for.
export type CountTokens = (text: string) => number;

export const countTokens: CountTokens = (text) => encode(text).length;
