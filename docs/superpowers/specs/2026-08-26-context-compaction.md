# Context Compaction Design

**Date:** 2026-08-26
**Status:** Approved

## Problem
Free models have small context windows (Groq TPM 8000 tokens/request, Mistral ~32k). When a dialog grows past ~50k tokens, providers reject requests instantly (HTTP 400/422) → "long thinking" and error loops. The proxy needs to automatically keep context within a size that most free models can handle.

## Solution
**Context compaction before sending to provider**: when a dialog exceeds 50k tokens, old messages (everything except the last ~10k tokens) are compressed into a single summary message by a long-context model. The summary is inserted at the start; recent messages remain untouched.

## Architecture — new `lib/compactor.js`

Single module with clear functions:

| Function | Purpose | Depends on |
|----------|---------|-----------|
| `estimateTokens(messages)` | Estimate token count (≈ content chars / 3.2) | — |
| `prepareMessages(messages)` | If ≤ 50k → return as-is. If > 50k → compact | `compactOld`, `estimateTokens` |
| `compactOld(messages)` | Trim last ~10k, compress the rest into one summary message | LLM fallback chain |
| `getSummary(messages)` | Hash compacted messages → return cached summary or generate new | summary cache |

## Data flow
```
server.js → handleChatCompletion
  → messages = body.messages (AFTER vision pipeline)
  → prep = prepareMessages(messages)     // ≤50k → as-is
        │  >50k:
        │    1. old = messages[:-keepRecent]
        │    2. hash = sha1(JSON.stringify(old))
        │    3. summary = summaryCache.get(hash) ?? generateSummary(old)
        │    4. body.messages = [{role:'user', content:'[Резюме диалога]\n'+summary}] + messages[-keepRecent:]
        │    5. summaryCache.set(hash, summary)
  → normal routing (bandit, provider selection)
```

## Summarizer fallback chain
`compactOld` sends the fragment to long-context models in reliability order; on reject/timeout → next:
```
or-nemotron-550b → or-nemotron-120b → or-nemotron-35 → or-dots-3 → hf-DeepSeek-V4-Pro
```

## Tokens
- Compaction threshold: **50k**
- Keep recent: **~10k** tokens untouched
- Summary limit: **~1000** tokens

## Error handling
- If all summarizers fail → **don't compact**, send as-is (better risk of 400 than losing the dialog)
- Summary message role is `{role:'user'}` (not `system`, to avoid conflicting with system instructions)

## Caching
- Summary cached in a separate `summaryCache` (NOT the main semantic cache, to avoid interference)
- Cache key = sha1 hash of the JSON of compacted messages
- Reused while dialog unchanged → no repeated LLM calls

## Testing — `test/compactor.test.js`
- `estimateTokens` estimates correctly
- ≤ 50k → no changes
- > 50k → summary appears, recent messages intact
- cache: second call with same hash does NOT trigger a new LLM call
- summarizer fallback: first fails → second succeeds
- summarizer chain fully fails → returns original messages (no compaction)

## Files
| File | Action |
|------|--------|
| `lib/compactor.js` | Create — compaction + summary cache |
| `server.js` | Modify — call `prepareMessages` after vision pipeline, before routing |
| `test/compactor.test.js` | Create — tests |

## Non-goals
- No persistence of summaries across restarts (in-memory only, like the main cache)
- No streaming of the compaction process (blocking, but only for large dialogs)
- Vision pipeline compaction handled separately (images already converted to text before this step)
