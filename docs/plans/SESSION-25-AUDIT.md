# Session 25 — Audit: the Ollama interaction, measured

**Status**: Measurement record for [SESSION-25-OLLAMA-INTERACTION.md](SESSION-25-OLLAMA-INTERACTION.md)

Sessions 19–24 built the machinery Pi Taster uses to fit an agent into a local
model's context window: a discovered window, scaled compaction, a trimmer, an
edit-repair hook, a context meter. None of it had been measured against the
daemon it manages. This document is that measurement, kept separate from the plan
so the numbers can be re-taken and compared after the work lands.

## Rig

| | |
|---|---|
| Machine | Apple M1 Max, 64 GB unified memory |
| Daemon | Ollama 0.33.2, **MLX engine** (`ollama runner --mlx-engine`) |
| Model | `qwen3.8:27b-mlx`, nvfp4, 32 GB resident |
| Advertised window | 262 144 (`/api/show`) |
| **Served window** | **65 536** (`/api/ps`) |
| `OLLAMA_*` env | none set — all defaults |
| Date | 2026-09-03 |

The advertised/served split is the one `context-budget.ts` was written for, and
it is real on this rig: 262 144 against a served 65 536, a factor of four.

## 1. Prefill dominates, and the KV prefix cache is worth ~500x

`/api/chat`, `think:false`, `temperature:0`, `num_predict` 4–8, so the timings are
prefill and essentially nothing else.

| # | Request | Prompt tokens | Prefill | Rate |
|---|---|---|---|---|
| 1 | Cold prefix | 11 431 | **133.51 s** | 85.6 tok/s |
| 2 | Byte-identical resend | 11 431 | **0.24 s** | ~47 800 tok/s |
| 3 | Append-only growth (+1 089) | 12 520 | 50.90 s | — |
| 4 | **One early message rewritten** | 11 481 | **124.37 s** | 92.3 tok/s |
| 5 | Resend of the rewritten list | 11 481 | 0.16 s | — |

Three things follow.

**A cold prefill of the full served window costs ~12.8 minutes** at 85.6 tok/s.
That is not a pathology, it is the machine's throughput. It means the context
window has a wall clock, and no surface in Pi Taster currently says so.

**Rows 1 and 2 are the same prompt.** The difference is entirely the daemon's KV
prefix cache. Preserving a prompt prefix byte-for-byte is worth roughly 500x on
this rig — larger than any other lever in this audit by two orders of magnitude.

**Row 4 is the finding.** Changing a single message *early* in the list costs a
full re-prefill: 124 s, against 0.24 s for leaving it alone. Row 5 confirms the
cache then re-forms around the new bytes. Rewriting history is not cheap and not
free — it is the most expensive thing Pi Taster can do to a turn.

**Row 3 is not fully explained and should not be over-read.** Append-only growth
of ~1 089 tokens cost 50.9 s, which is far better than a full re-prefill (row 4)
but far worse than the ~13 s those tokens would cost at the cold rate. Reuse on
the MLX engine is evidently partial or block-quantised rather than exact.
Characterising it precisely is listed as an open question in the plan, because it
sets the ceiling on what W1 can recover.

### What this explains

`http-dispatcher.ts:49-52` records two requests on 2026-09-03 tripping the stream
timeout at ~1836 s and ~2266 s, and treats them as a reason to raise the idle
timeout from 30 minutes to one hour. At 85.6 tok/s those durations correspond to
roughly 157 k and 194 k tokens of prefill work — more than the served window,
which is consistent with a large prompt being re-prefilled more than once inside
a single turn. **They were not network faults.** The timeout increase was still
correct; the diagnosis was incomplete.

## 2. The daemon reports the cache hit, and Pi already carries it

Rows 1–5 above measure prefix reuse by timing it. The daemon also **reports** it.
Ollama's OpenAI-compatible endpoint populates `prompt_tokens_details.cached_tokens`,
on the streaming path as well as the blocking one:

```
POST /v1/chat/completions   model qwen3-vl:4b, stream, ~4k-token system prefix

request 1  9.55 s   {"prompt_tokens": 4023, "prompt_tokens_details": {"cached_tokens": 0}}
request 2  0.08 s   {"prompt_tokens": 4023, "prompt_tokens_details": {"cached_tokens": 4022}}
```

Grown to a 12 k prefix sharing the first 4 k, streaming, headers timed:

```
request 3  17.52 s  {"prompt_tokens": 12023, "prompt_tokens_details": {"cached_tokens": 4003}}
           headers at 17.52 s, first chunk at 17.52 s
```

A smaller model than the rig's, deliberately — what is being established is the
**reporting**, not the rate.

Three things follow, and together they are why W2 is cheap.

**Prefix reuse is measured, not inferred.** A verdict derived from an implied prefill
rate needs a per-model cold rate to compare against and cannot distinguish a fast
request from a small one. `cached_tokens` answers directly, and answers the *partial*
case too — request 3 reused 4 003 of a 4 023-token shared prefix, which is the shape
row 3 of §1 hinted at.

**Pi already parses it, and already subtracts it.**
`pi-ai/dist/api/openai-completions.js:1175-1190` maps `prompt_tokens_details.cached_tokens`
to `Usage.cacheRead` and sets `input = prompt_tokens − cacheRead − cacheWrite`. So
`usage.input` is exactly the prompt the daemon had to prefill and `usage.cacheRead` is
exactly what it reused — the correct numerator and denominator for a prefill rate,
arriving in every response since Session 15 with nothing reading them. Pi sends
`stream_options: {include_usage: true}` (`openai-completions.js:595`), which is what
makes them arrive on the streaming path Pi Taster uses.

**Response headers are withheld until prefill completes.** Request 3's headers and its
first chunk both landed at 17.52 s. That is what makes the gap between Pi's
`before_provider_request` and `after_provider_response` hooks a prefill measurement
rather than a round-trip, and it is the same property that makes a long prefill die as
an undici `headersTimeout` rather than as anything Pi can name.

### Observed in the running app

Both of the above were then seen from Pi Taster itself, in `~/.ollama/logs/server.log`,
during a turn on the author's Moon Phase sub-app:

```
prefix_cache.go:125  msg="cache hit" total=99477 matched=40960 cached=40960 left=58517
pipeline.go:223      msg="Prompt processing progress" processed=2048 total=58517
```

Two things in one line, and the second is the more serious.

**Reuse is partial and looks granular.** 40 960 of a 99 477-token prompt were reused and
58 517 were prefilled. 40 960 is exactly 10 × 4096, which is consistent with reuse at a
block boundary and would explain §1's row 3 — but it is one sample, and the 4b runs above
reused 4 022 and 4 003 tokens, neither of which is block-aligned. Treat the granularity as
open, not established.

**Pi Taster handed the daemon a 99 477-token prompt against a served window of 65 536.**
Ollama does not refuse that; it truncates the head of the prompt silently, which is the
failure `AGENTS.md` already warns about. Whatever the cause — and F2 says compaction is
deciding from a number the trimmer never writes back — the app was, in ordinary use,
sending half again as much as the window can hold. Nothing in the UI said so: the meter
was reading `4k / 32.8k` in that app during these runs, though not measurably at the same
instant as the log line. This was not in scope for the audit and is not explained here; it is
recorded because it was observed, and because it raises the stakes on W1 and F2 from
"slow" to "silently losing the head of the prompt".

## 3. Thinking is on for every request

`/v1/chat/completions`, eight variants, same trivial prompt. Every response
carried a populated `reasoning` field on the message.

| Payload | Prompt/completion tokens | `reasoning` chars |
|---|---|---|
| plain | 25 / 54 | 73 |
| `temperature: 0` (Pi Taster's default) | 25 / 54 | 73 |
| `top_p: 0.8, temperature: 0.7` | 25 / 54 | 73 |
| `seed`, `frequency_penalty` | 25 / 54 | 73 |
| `keep_alive: "30m"` | 25 / 54 | 73 |
| `reasoning_effort: "low"` | 55 / 52 | 65 |
| `top_k: 20` | 25 / 54 | 73 |
| `chat_template_kwargs: {enable_thinking: false}` | 25 / 54 | 73 |

`session.ts:637` passes `thinkingLevel: 'off'`. `ollama.ts:400` sets
`supportsReasoningEffort: false`, which strips the parameter that would carry it.
The net effect is that Pi Taster believes thinking is off and it has never been off.

`reasoning_effort` **is** honoured — it changes the prompt token count, so the
daemon is injecting something into the template — but weakly and unevenly:

| `reasoning_effort` | Wall | Prompt | Completion | `reasoning` chars |
|---|---|---|---|---|
| (absent) | 11.8 s | 49 | 268 | 379 |
| `low` | 16.1 s | 79 | 251 | 339 |
| `medium` | 13.2 s | 49 | 268 | 379 |
| `high` | 18.6 s | 91 | 357 | 822 |

`medium` is byte-identical to absent; `low` and `high` are distinct. It is a real
control, currently disabled by a compat flag.

Ollama's native `think: false` does work — `session-title.ts:141` relies on it —
but that is `/api/generate`, not the `/v1` path Pi uses. Turning thinking off on
the agent path is therefore not a flag, it is an architectural change.

`events.ts:203-204` maps `thinking_delta` to `null`, so none of this reaches the
UI. During a long reasoning phase the user sees the pulsing ellipsis from
`TextBubble.tsx:41-43` and nothing else until the stall notifier fires at 20 s.

### The reasoning is emitted but never counted

Ollama returns the reasoning as text and does **not** break out its token count. A
blocking `/v1` call to `qwen3-vl:4b` on a prompt that forces thinking:

```
usage           {"prompt_tokens": 23, "prompt_tokens_details": {"cached_tokens": 0},
                 "completion_tokens": 200, "total_tokens": 223}
message.reasoning   597 characters
```

There is no `completion_tokens_details`, so `reasoning_tokens` is absent and Pi's
`Usage.reasoning` — which reads exactly that field — is `0` on every Ollama response.
The reasoning tokens are inside `completion_tokens`; they are simply never separated.

This was confirmed against the live telemetry: a settled turn reported
`1 request · 4.8k prompt (707 prefilled) · 22 out · 8.9s` with no thinking figure at all.

**A zero there means "not reported", not "no thinking happened".** Reading it the other
way is the same mistake as F3 itself — Pi Taster believing thinking was off because the
setting said so. The cost of reasoning on this daemon is therefore not directly
measurable; it can only be inferred from `completion_tokens` against how much text the
model actually produced.

## 4. Which sampling parameters `/v1` accepts

No variant above returned an error, so "accepted without a 400" proves nothing on
its own. The honoured set is the OpenAI-compatible one Ollama maps: `temperature`,
`top_p`, `seed`, `frequency_penalty`, `presence_penalty`. `top_k`, `min_p` and
`repeat_penalty` are Ollama-native `options` and have no place in the `/v1`
schema — they were accepted silently and there is no evidence they took effect.
Do not build on them.

Pi Taster currently sets exactly one: `temperature`, via `createSamplingExtension`
(`session.ts:338-348`), defaulting to `0`.

## 5. Two hypotheses that were disproved

Recording these is the point of a separate audit document — both are plausible,
both are wrong on this rig, and both would otherwise be re-investigated.

**`keep_alive` does not decay to the daemon default on the `/v1` path.** The
concern was that `warmModel` sets `keep_alive: '30m'` once (`ollama.ts:350`) but
`/v1` requests carry no such field, so each would reset the timer to Ollama's
5-minute default and a 32 GB model would unload between turns.

Measured — clock at 14:33:08:

| Action | `/api/ps` expiry |
|---|---|
| plain `/v1` request | 15:03:09 |
| `/v1` with `keep_alive: "22m"` | 15:03:09 |
| plain `/v1` request again | 15:03:10 |

The expiry tracks **+30 minutes** throughout. `keep_alive` is sticky per model
*load*: whatever set it at load time governs, later requests refresh against that
stored duration, and a `keep_alive` in a `/v1` body is ignored. Pi Taster's warm call
is doing its job and needs no change.

The residual case is a model loaded by something other than Pi Taster — `ollama run`
in a terminal — which would carry the 5-minute default instead. Minor, and worth
a line in the UI rather than a fix.

**The ~1836 s / ~2266 s timeouts were not network faults.** See §1.

## 6. Reproducing this

Both scripts assume the daemon is on `127.0.0.1:11434` and the model is pulled.
Run them with nothing else driving Ollama — a running Pi Taster will contend for the
same runner and inflate every number.

```python
#!/usr/bin/env python3
"""Prefix-cache behaviour under history rewrites. Ollama native /api/chat."""
import json, urllib.request, time

BASE, MODEL = "http://127.0.0.1:11434", "qwen3.8:27b-mlx"

def chat(msgs):
    req = urllib.request.Request(
        BASE + "/api/chat",
        data=json.dumps({"model": MODEL, "messages": msgs, "stream": False,
                         "think": False, "keep_alive": "30m",
                         "options": {"num_predict": 4, "temperature": 0}}).encode(),
        headers={"Content-Type": "application/json"})
    t = time.time()
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.loads(r.read()), time.time() - t

def show(label, b, wall):
    pc, pd = b.get("prompt_eval_count"), b.get("prompt_eval_duration", 0) / 1e9
    print(f"{label:38s} wall={wall:7.2f}s  prompt={pc:6d} tok  "
          f"prefill={pd:7.2f}s  ({pc / pd if pd else 0:8.1f} tok/s)")

sysp = "You are a coding agent in a sandboxed app root. Obey the rules.\n" * 150
def toolres(i, n=60):
    return (f"[tool_result read src/mod{i}.ts]\n" +
            "\n".join(f"  {j}: export const sym{i}_{j} = compute({j});" for j in range(n)))

hist = [{"role": "system", "content": sysp}]
for i in range(8):
    hist += [{"role": "user", "content": f"Please inspect module {i}."},
             {"role": "assistant", "content": f"Reading module {i}."},
             {"role": "user", "content": toolres(i)}]

base = hist + [{"role": "user", "content": "Reply OK."}]
show("1. fresh history (cold prefix)", *chat(base))
show("2. identical resend (cache hit)", *chat(base))

grown = hist + [{"role": "user", "content": "Now inspect module 9."},
                {"role": "assistant", "content": "Reading module 9."},
                {"role": "user", "content": toolres(9)},
                {"role": "user", "content": "Reply OK."}]
show("3. append-only growth", *chat(grown))

trimmed = [m.copy() for m in grown]
trimmed[3]["content"] = "[tool_result read src/mod0.ts]\n[truncated - 60 lines omitted]"
show("4. EARLY message rewritten (trim)", *chat(trimmed))
show("5. resend of trimmed (cache hit)", *chat(trimmed))
```

```python
#!/usr/bin/env python3
"""What the OpenAI-compatible /v1 path accepts, and whether thinking is on."""
import json, urllib.request, urllib.error, time

URL, MODEL = "http://127.0.0.1:11434/v1/chat/completions", "qwen3.8:27b-mlx"
Q = [{"role": "user", "content": "What is 17*23? Answer with just the number."}]

def post(extra, label):
    req = urllib.request.Request(
        URL, data=json.dumps({"model": MODEL, "messages": Q, **extra}).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer ollama"})
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            b = json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"{label:36s} HTTP {e.code}: {e.read()[:200].decode()}")
        return
    msg, u = b["choices"][0]["message"], b.get("usage", {})
    reasoning = msg.get("reasoning") or msg.get("reasoning_content") or ""
    print(f"{label:36s} {time.time() - t:5.1f}s  "
          f"usage={u.get('prompt_tokens')}/{u.get('completion_tokens')}  "
          f"reasoning_chars={len(reasoning)}")

post({}, "plain (defaults)")
post({"temperature": 0}, "temperature:0 (Pi Taster default)")
post({"top_p": 0.8, "temperature": 0.7}, "top_p + temp 0.7")
post({"seed": 42, "frequency_penalty": 0.1}, "seed + frequency_penalty")
post({"keep_alive": "30m"}, "keep_alive on /v1")
post({"top_k": 20}, "top_k (ollama-native param)")
post({"chat_template_kwargs": {"enable_thinking": False}}, "chat_template thinking=off")
for effort in ("low", "medium", "high"):
    post({"reasoning_effort": effort}, f"reasoning_effort:{effort}")
```

## 7. Re-taken after W1 landed

The comparison that matters is row 4 against row 2: does a turn boundary still cost
a full re-prefill? It does not.

Measured on the running app — a fresh chat in the Moon Phase sub-app, four turns,
each asking the agent to read a file and answer in one sentence. The numbers are the
daemon's own, from `~/.ollama/logs/server.log`, which reports every prefix-cache
lookup: `matched` is what it reused, and the difference is what it had to prefill.

| Turn boundary | Prompt | Matched | **Prefilled** |
|---|---|---|---|
| 1 → 2 | 7292 | 7265 | **27** |
| 2 → 3 | 7573 | 7548 | **25** |
| 3 → 4 | 9501 | 9474 | **27** |

Twenty-five to twenty-seven tokens is the new user message and nothing else. Under
the previous design each of these was a row-4 event: the previous turn's tool result
lost its `inCurrentTurn` exemption the moment the next turn began, was rewritten in
the middle of the prefix, and cost a prefill of the whole prompt — 124.4s on the
11481-token prompt of row 4.

Requests *within* a turn append, as they always did: 118, 1727 and 82 tokens, the
1727 being a `read` result the model had just asked for.

**What this run does not show.** The conversation reached about 9.6k tokens against
a `sealAdvanceTokens` of 16384, so the seal never advanced. What is measured here is
the elimination of the per-turn rewrite, which is the dominant cost; the batched
invalidation when the seal does advance is covered by tests, not by this run. A
longer session is what would measure it, and the telemetry from W2 —
`N invalidated` in the turn summary — is where it would show up.

### Reproducing it

```bash
# Watch the daemon's own cache accounting while driving the app.
tail -f ~/.ollama/logs/server.log | grep --line-buffered prefix_cache
```

Send successive prompts that each make the agent read a file. A healthy boundary
shows `matched` within a few dozen tokens of `total`; a rewritten prefix shows
`matched` collapsing to whatever precedes the rewrite.
