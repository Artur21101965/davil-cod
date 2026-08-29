# Vector Memory / Hybrid Sliding-Window

**Date:** 2026-08-29
**Status:** Implemented (freegate 0.6.15+)
**Tests:** 109/109 (added memory, memory-store, compactor-facts suites)

## Problem

Compaction (`lib/compactor.js`) keeps provider windows happy but irreversibly
flattens conversation detail into one summary. A new session starts with empty
context, losing decisions made days earlier — the agent re-derives what was
already solved.

## Solution

Hybrid memory = existing sliding-window **working memory** + a new long-term
layer of extractable facts that get re-injected into context when relevant.

```
Working memory (exists)           Long-term memory (new)
  sliding window + summary   →     vector store in memory.json
  lib/compactor.js                 lib/memory.js + lib/memory-store.js
        │ compacting (already calls LLM!)
        ▼
  facts extracted as a FREE side effect of that same LLM call
        │
        ▼
  recall(query) → top-K relevant facts unshifted as user message
        ▼
  provider receives context with past decisions
```

## Zero-dependency vector layer (`lib/memory.js`)

- **tokenize**: lowercase, split on `\W+`, drop stop-words and <3-char tokens;
  add suffix-trigrams (`_<last3>`) for Russian morphology.
- **Prefix-expansion**: `запросы` covers `запрос` (4..len-1 prefixes) so
  word-forms intersect without a stemmer.
- **Scoring**: TF-IDF (rare tokens weigh more), normalized by `sqrt(len(query))`,
  exact word weight 1, trigram 0.5. 0 shared tokens → score 0 (unrelated filtered
  by any threshold > 0). Default `minSimilarity 0.05`, `topK 3`.
- **Churn**: capacity 800, evict lowest `access` then oldest; dedupe by sha1 of
  normalized text.

## Extraction — free, only during compaction

`getSummary` (`lib/compactor.js`) asks the summarizer for
`{"summary": "...", "facts": ["...", ...]}` (JSON or fenced block). Plain-text
answers keep old behavior (summary only, no loss). No extra LLM calls — facts
are a side effect of the compaction call that already happened.

## Injection (`server.js`, handleChatCompletion)

After `prepareMessages`, before `cache.get`:

```
query = last 3 user texts (text parts only)
hits = memStore.recall(query, {topK, minSimilarity})
fresh = hits not covered (≥60% overlap) by recent msgs / compaction resume
block = { role:'user', content:'[Память: релевантные факты из прошлого]\n'+fresh }
insert after leading system messages
```

Why `user` (not `system`): `lib/normalize.js` builds the cache key from
`user`+`assistant` only. As `user`, different fact sets produce different cache
keys → no stale-cache poisoning. System messages stay untouched (same rule as
the compactor).

## Persistence (`lib/memory-store.js`)

- `memory.json` `{version, saved, facts:[{text, sourceHash, created, access}]}`.
- Corrupt/missing file → empty start (same pattern as state.json).
- Save: atomic write via `.tmp` rename, every 60s + on SIGINT/SIGTERM.
- `config.memory.enabled=false` disables the whole layer; defaults are on.

## Files

| File | Change |
|------|--------|
| `lib/memory.js` | New — tokenize / MemStore / recall / isCovered |
| `lib/memory-store.js` | New — load/save/evict over MemStore |
| `lib/compactor.js` | Modify — JSON summary parsing, `setMemory`/`ingestFacts` |
| `server.js` | Modify — recall between compaction & cache, autosave, SIGTERM |
| `test/memory.test.js` | New |
| `test/memory-store.test.js` | New |
| `test/compactor.test.js` | Modify — parse + ingest facts tests |

## Live verification

- 700-msg session → compaction → 5 facts in `memory.json` (keepAlive, maxSockets
  64, latency 0.5s→0.016s, minimax-m3 mapping, 60k threshold).
- Fresh server restart (no new compaction) → "какие параметры keepalive мы уже
  настроили?" answered with the stored facts — persistence proven.

## Limits

- TF-IDF ("vector-lite") is weaker on paraphrases than real embeddings —
  justified by zero-dep + zero-cost. `recall()` API is swappable for a real
  embedder later.
- Facts only accumulate when compaction actually runs (`extractEveryTurn:false`
  by default). Small sessions never hit it.
- `isCovered` dedupe uses substring/word overlap ≥60% to avoid re-mixing facts
  already present in the current session's resume/messages.