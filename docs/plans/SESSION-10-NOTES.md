# Session 10 Notes: Respect Claude API Rate Limits

## Implementation Summary

Session 10 adds handling for Claude API 429 rate-limit errors with retry-with-backoff logic and user-visible feedback in the chat UI.

## Files Modified

| File | Changes |
|------|---------|
| `packages/core/src/agent.ts` | Added `'rate_limit'` to `StreamChunk.type` union, added `retryAfterSeconds` field |
| `apps/electron/src/main/agent.ts` | Imported `APIError`, added retry constants, restructured catch block for 429 handling |
| `apps/electron/src/preload/index.ts` | Updated local `StreamChunk` type with `'rate_limit'` and `retryAfterSeconds` |
| `apps/electron/src/renderer/src/types/electron.d.ts` | Updated `StreamChunk` type with `'rate_limit'` and `retryAfterSeconds` |
| `apps/electron/src/renderer/src/components/Chat.tsx` | Added `rate_limit` chunk handler to display retry notice |

## Key Implementation Details

### Retry Logic

- **Max retries**: 3 (`MAX_RATE_LIMIT_RETRIES`)
- **Default wait**: 60 seconds (`DEFAULT_RETRY_AFTER_SECONDS`), used when `retry-after` header is missing
- **Retry counter**: Scoped to the entire `runAgentQuery` call, not per loop iteration, bounding total 429 retries across the full agentic conversation
- **429 detection**: Uses `error instanceof APIError && error.status === 429` from `@anthropic-ai/sdk`
- **Header parsing**: Reads `error.headers?.['retry-after']` as integer seconds, falls back to default

### Retry Flow

1. `client.messages.stream()` throws a 429 `APIError`
2. Catch block detects 429 and checks retry budget
3. Extracts `retry-after` from error headers (or uses 60s default)
4. Emits `onStream({ type: 'rate_limit', retryAfterSeconds })` so the UI can inform the user
5. Waits the specified duration via `setTimeout`
6. Sets `continueLoop = true` and `continue` to re-attempt the same request
7. If retries exhausted, falls through to the normal error path

### Non-429 Errors

Non-429 errors are unaffected -- they still emit `onStream({ type: 'error' })` and return immediately, exactly as before.

### UI Feedback

The Chat component handles the `rate_limit` chunk by appending an italic text block to the current assistant message:

```
*Rate limited by API. Retrying in 60s...*
```

The `isStreaming` state stays `true` during the wait -- the agent is still working, and the UI reflects this.

### Anthropic SDK Built-in Retries

The Anthropic SDK has its own built-in retry logic (defaults to 2 retries). Our retry layer sits on top as an additional safety net that also provides user-visible feedback. In practice, the SDK may handle transient 429s before our code ever sees them.

## Testing Checklist

- [x] Types compile without errors (`bun run typecheck:all`)
- [x] No linter errors
- [ ] 429 from Messages API is caught in `agent.ts`
- [ ] `retry-after` is read when present; default wait used when not
- [ ] Retry loop has bounded max retries (3)
- [ ] Stream chunk type includes `rate_limit` with `retryAfterSeconds`
- [ ] Chat UI shows "Rate limited; retrying..." message
- [ ] Non-429 errors are not retried and still surface to the user

## Potential Future Improvements

1. **Prompt caching**: Use prompt caching for system prompt / tools / history to reduce ITPM and improve effective throughput
2. **Header-based UI**: If the SDK exposes rate limit headers on successful responses, show "X requests / Y tokens remaining" in settings or during chat
3. **Configurable max retries**: Allow user or config to set max retries for 429
