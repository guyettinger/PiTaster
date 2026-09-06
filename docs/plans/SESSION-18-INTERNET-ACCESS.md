# Session 18: Internet Access

**Goal**: Give the agent a first-class, gated way to reach the internet, and fix
the unexamined hole it was already reaching through.

## Why

Key Lime Pi runs on local Ollama models. Their knowledge of library APIs is smaller
and staler than a frontier model's, so the most common failure is not a logic
error — it is confidently calling a function that does not exist. The agent had
no sanctioned way to check.

It could reach the internet anyway. `BLOCKED_COMMANDS` was only
`['rm -rf /', 'sudo', '> /dev', 'dd if=', 'mkfs', ':(){']`, and `inspectCommand`
scans for filesystem paths, so `bash curl https://example.com` passed confinement
untouched and ran unprompted under `bypassPermissions`. The work is therefore not
"add network capability" but "make network access legible and deliberately gated".

## Rejected: Pi's extension ecosystem

Pi ships no web tool. Every web capability in its ecosystem — `pi-web-access`,
`@pi-stef/web`, `pi-webfetch`, `pi-smart-fetch` — is a third-party npm package
loaded in-process via `jiti` with full Node permissions. Such an extension loads
*beside* `permission-gate.ts`, not behind it, and can touch the filesystem at
module load before any `tool_call` handler fires. It would also require npm/git
on the user's machine at runtime.

Native `defineTool()` tools in the main process, following `version-tools.ts`,
keep every request inside the existing gate. That is the approach taken.

## Decisions

| Question | Decision |
|---|---|
| Mechanism | Native tools, not a Pi extension or bundled MCP source |
| Search | None. `web_fetch` only — no API key, no scraping to maintain |
| Host policy | None. No allowlist, blocklist, or private-range guard |
| Safety property | GET-only with no request body: cannot write or execute |
| Residual risk | A model-chosen URL is an egress channel; accepted, not solved |
| `web_fetch` gating | plan: allow, default: ask, acceptEdits: allow, bypass: allow |
| `install_deps` gating | plan: deny, default: ask, acceptEdits: **ask**, bypass: allow |
| `bash` | Annotate network use for the approval prompt. No blocking |

## Scope

1. **`web_fetch`** — GET-only URL fetch, HTML reduced to readable text, bounded by
   time (15s), response bytes (500KB, streamed), and result characters (100KB).
2. **`install_deps`** — `bun install` in the app root, promoted out of `bash`.
   Not auto-approved in `acceptEdits`: `bun` runs the project's own
   `preinstall`/`postinstall`, and the agent can already write `package.json`
   unprompted, so auto-approving would compose into unprompted arbitrary shell.
   It commits the lockfile itself, since it has no `path` for the usual hook.
3. **Credential leak fix** — `apps:install-deps` spawned `bun install` inheriting
   the full `process.env`. Shared `buildSubprocessEnv` now filters both it and
   the MCP client.
4. **`describeNetworkUse`** — annotates `bash` commands that reach the network,
   surfaced as a `notice` on the approval prompt. Advisory, not enforcement.
5. **`lookup-docs` runtime skill** — teaches the agent when to reach for docs.

## The plan-mode exception

`plan` previously denied every tool with no exceptions list, and
`.claude/rules/self-modification.md` said so explicitly. `web_fetch` is the one
exception: a GET with no body cannot write a file, run a command, or modify the
app, so it leaves both as it found them — which is what `plan` promises. The rule
was amended in the same change rather than left to contradict the code.

This holds **only** while the tool stays GET-only, and it is narrower than "it
only reads": the model controls the whole URL, so a GET's query string is an
egress channel. With no host policy and no prompt in `plan` or `acceptEdits`,
that is an accepted residual risk, mitigated only by the call and its URL being
visible in the transcript.

## Not in scope

No `web_search`, no search provider, no `safeStorage` reintroduction, no host
policy, no network off-switch setting, no Pi extension loader, and none of the
ecosystem's memory/subagent/orchestration extensions.
