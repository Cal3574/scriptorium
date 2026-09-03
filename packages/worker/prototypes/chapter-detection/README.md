# THROWAWAY PROTOTYPE - chapter detection & book-summary strategy

Answers wayfinder ticket #7. **Not production code.** Delete once the spec section lands.
Lives here (next to `packages/worker`) because the ingest pipeline is what it prototypes for.

## What it does

1. `1-parse.mjs` - submits `mock-data/The_Pragmatic_Programmer.pdf` to LlamaParse v2 (cost-effective
   mode), polls to completion, caches markdown + `items` + `metadata` JSON to `.cache/`.
   Spends ~real credits once, then re-reads the cache.
2. `2-detect.mjs` - runs candidate chapter-detection heuristics over the cached parse and prints
   the detected chapter list + page ranges, so we can eyeball reliability against the real book.
3. `3-summarise.mjs` - measures token budget + cost for whole-book summary strategies
   (single-pass over full markdown vs map-reduce over chapter summaries) and runs one
   chapter deep-dive prompt, printing inputs/outputs/tokens/cost.

## Run

```
cd packages/worker/prototypes/chapter-detection
cp .env.example .env   # or symlink the worker .env - needs LLAMA_CLOUD_API_KEY + ANTHROPIC_API_KEY
pnpm install --ignore-workspace
node 1-parse.mjs        # once - writes .cache/
node 2-detect.mjs
node 3-summarise.mjs
```

## Findings

See `docs/wayfinder/chapter-detection-strategy.md` (the spec section this prototype produced)
and the resolution comment on issue #7.
