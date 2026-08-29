# Freegate — Semantic Cache + Window-Aware Compaction (design)

**Date:** 2026-08-29
**Status:** Approved design
**Scope:** two features in one spec — semantic cache layer + context-window-aware compaction

## Problem

Freegate caches exact normalized matches only. Rephrased repeat requests (same
intent, different wording) miss the cache and pay a full LLM call. Compaction
currently fires at a single global threshold (60k est tokens) regardless of the
target model's real context window — so it either overshoots small-window
providers (codestral 33k) or re-drops context prematurely for 1M-window models
(minimax-m3).

Real provider windows (from providers.json):
- codestral (tier-s) **33k**, lfm **65k**, zai/groq 128k, openrouter-hermes 256k,
  groq-qwen/dots-3 **262k/512k**, minimax-m3 (tier-splus) **1M**.

## Part 1 — Window-aware compaction

Change `prepareMessages(messages)` → `prepareMessages(messages, { contextWindow })`.

New helper `compactionThresholdFor(win)`:

| window (context_window) | effective threshold | reason |
|---|---|---|
| unknown / 0 | 60000 | status quo |
| defined | min(win*0.5, 100000) | provably fits: est*2 ≈ real tokens ≤ win |

One formula, no branches:
```
function compactionThresholdFor(contextWindow) {
  if (!contextWindow || contextWindow <= 0) return COMPACT_THRESHOLD; // 60000 unknown
  return Math.min(Math.floor(contextWindow * 0.5), 100000);
}
```

Safety invariant: estimateTokens empirically undercounts real provider tokens
~2x (compactor.js comment), so est*2 ≈ real. Capping est at win*0.5 guarantees
real ≤ win — no more provider 400s from overlong requests, and no early re-drop
for 1M-window models (raise capped at 100k est ≈ 200k real, far below 1M).

computed table: codestral 33k→16.5k, lfm 65k→32.8k, zai/groq-gpt 128k→64k,
groq-qwen 262k→100k, dots-3 512k→100k, minimax 1M→100k.

Server passes target provider window: `prepareMessages(body.messages, { contextWindow: PROVIDERS[targetProviderKey]?.context_window || 0 })`.

Keeps `KEEP_RECENT_TOKENS=30000` (recent-tail untouched), summary cache, and the
no-compaction-if-no-gain guard. Existing callers without `{contextWindow}` keep
old behavior (default 60000) — no behavioral surprise for summarize/vision paths.

## Part 2 — Semantic cache

New file `lib/semcache.js` + a `getSemantic()` hook on `lib/cache.js`.

Cache already uses `normalizeMessages()` (returns normalized full-dialog string).
Semantic layer extends it:

- `getSemantic(model, messages, temperature, minSimilarity=0.85)` runs AFTER the
  exact `get()` misses.
- Safety guards — skip if:
  - normalized text is empty (image-only / all-tool messages),
  - `looksLikeCode(messages)` (code operators must match exactly),
  - any message has non-string content (arrays/tool/image parts) — don't serve
    stale answers when the request carries tool state/attachments,
  - any message `role === 'tool'` (different tool state => different intent),
  - `model` or `temperature` differs from the cached entry.
- Scoring: **Dice coefficient on char-trigrams** of the normalized dialog text.
  char-3-grams are the standard zero-dep trick for near-duplicate short text;
  Dice α=0.85 proven conservative balance between not poisoning answers and
  catching rephrasings. Tunable via `config.semcache = { enabled=true, minSimilarity=0.85 }`,
  merged with defaults like `config.memory` (enabled=false disables the layer).
- Storage: per cache entry store `grams` (char-trigram set) alongside
  `{key,value,created,uses}`; persisted in `cache.json` so the semantic index
  survives restarts along with exact entries.
- Churn: grams ride along with exact entries — same eviction (LRU/MRU + uses),
  same TTL, same 300-entry disk trim; no extra eviction logic.
- Metrics: add `semHits` counter; `stats()` exposes it and hit-rate includes it.

Server integration (after `cache.get()` returns null):
```
const semantic = cache.getSemantic(effectiveModel, body.messages, body.temperature, config.semcache?.minSimilarity);
if (semantic) → replay via existing cached-response code path; logger/RPM as provider:'semcache'
```

Extract the existing cached-response replay (both streaming SSE and JSON) into a
shared `serveCached(res, cached, isStreaming)` helper so the semantic path reuses it verbatim.

## Part 3 — Pool safety

server.js:392 `const MIN_WINDOW = 128000` → `50000`. Rationale: after window-aware
compaction pushes large-window requests (up to 100k est) through minimax/dots, the
fallback pool must not waste time trying codestral (33k)/lfm (65k) which can't hold
them. Since compaction now caps est ≤ ~100k, a request > 128k est never survives,
so `windowPool`'s old 128k trigger was dead code; 50k keeps typical traffic
(unfiltered) while filtering the big-window fallback case.

## Files

| File | Change |
|---|---|
| `lib/compactor.js` | `compactionThresholdFor`, `prepareMessages(msgs,{contextWindow})` |
| `lib/semcache.js` | new — trigrams `_dice()`, `getSemantic` core + guards |
| `lib/cache.js` | store `grams`, `getSemantic` hook, `semHits`, persist grams |
| `server.js` | pass contextWindow to prepareMessages; `getSemantic` on miss; `serveCached` helper; MIN_WINDOW→50000; semcache log/RPM |
| `test/compactor.test.js` | threshold table + options |
| `test/cache.test.js` | new — trigrams/dice, hits/misses/guards/persist |
| `test/proxy.test.js` | rephrase→semcache 200 |

## Testing (TDD)

Order: compactor threshold tests → semcache unit tests → proxy integration → pool.
Run `node --test test/*.test.js`; expect existing 109 + new suite all green.
Verify live on a real request (repeated rephrased prompt → provider semcache in log).

## Limits

- Dice on char-trigrams catches rephrasings, not radical rewording — acceptable
  for typical agent re-issue (`продолжай`/«исправь» variants); real embeddings
  would be a later upgrade but cost external deps.
- Only string-content dialogs are semantically cached; code and tool-state
  requests stay exact-match (safety first).
- Threshold/pool constants tunable via config, no magic in prod.