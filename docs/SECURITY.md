# Security

Pi Taster runs a coding agent with your permissions, on your filesystem. This page
is the honest account of what stops it, what doesn't, and what's left open on
purpose.

The rules below are not stylistic. Violating one is a security bug — see
[AGENTS.md](../AGENTS.md#safety-rules) for the same list in the form the agent
itself is held to.

## Where confinement lives

Pi ships no sandbox. Its built-in tools resolve `~` and absolute paths and run
with the process's permissions. So confinement is Pi Taster's job, and it happens in
one place: the `tool_call` handler in
[`apps/electron/src/main/agent/permission-gate.ts`](../apps/electron/src/main/agent/permission-gate.ts).

It resolves every path argument the way Pi will resolve it and rejects anything
landing outside the open app's root. Shell commands are checked against a
blocklist and scanned for out-of-root paths, including relative traversal and
paths hidden inside quotes.

That scan is best-effort — variable expansion defeats it — which is why `bash` is
never auto-approved outside **Auto — all**.

**The root itself is validated too.** Every check above asks whether a path is
inside the app's root, which makes that value the one input the whole boundary
rests on. It's built by joining an app id onto `~/.pitaster/apps`, and `join`
resolves `../../../tmp` without complaint. So an app id must be a single path
segment, and the resolved path must be a direct child of the apps root — checked
wherever an id becomes a path, not at whichever handler happened to receive it.

## Permission modes

| Mode | Behavior |
|------|----------|
| **Explore** (`plan`) | No side effects. Reads, searches, git inspection, and `web_fetch`. Nothing may change. |
| **Ask to edit** (`default`) | Prompt for approval on every tool use. |
| **Auto edit** (`acceptEdits`) | Auto-approve file operations and version tools. |
| **Auto — all** (`bypassPermissions`) | Auto-approve everything. Use with caution. |

**Explore** allows a specific list — `read`, `grep`, `find`, `ls`, `load_skill`,
`code_intel`, `git_status`, `get_history`, `list_branches` — plus `web_fetch`.
None of them can write a file, run a command, or move HEAD. Branch switching,
rollback and `refactor` are deliberately excluded: they change the app even when,
for the first three, nothing is written. `bash` is excluded because it is not a
read tool however read-only the command looks.

Anything unclassified falls through to a denial, so a tool added later can't
inherit read access by accident.

Two tools are exceptions to **Auto edit**, and both always prompt:

- **MCP source tools.** Path confinement can't reach inside a separate server process, so approval is their only boundary. **Explore** denies them outright.
- **`install_deps`.** Its command is fixed (`bun install`), which looks safe but isn't: `bun` runs the project's own `preinstall` and `postinstall` scripts, and in **Auto edit** the agent can already write `package.json` unprompted. Auto-approving the install would hand it arbitrary shell in two innocuous-looking steps.

## Electron hardening

- Every `BrowserWindow` sets `contextIsolation: true` and `nodeIntegration: false`.
- Raw `ipcRenderer` is never exposed across the context bridge — only narrow, named functions that unwrap the IPC event first.
- Every `ipcMain.handle` validates the type and length of its arguments before acting. The renderer is untrusted.
- Sensitive environment variables are filtered out before any child process is spawned.
- Secrets would go in Electron's `safeStorage`, never a plain file or `localStorage`. There are currently no secrets to store, because inference is local — that has to be reinstated before any remote provider is added.

## What is deliberately left open

**Network access is not confined.** There is no host allowlist. `web_fetch` can
reach `localhost`, the LAN, and link-local metadata addresses; the only check is
that the URL is well-formed `http(s)`. `bash` reaches the network too, and always
has — `curl` was never blocked — so such commands are annotated in the approval
prompt. That annotation is legibility, not enforcement.

The sharper version: the agent controls the whole URL, so a GET's query string
can carry data *out*. With no host policy and no prompt in **Explore** or **Auto
edit**, a fetch can exfiltrate anything already in context — and since **Explore**
reads files, "in context" reaches any file in the app root. This is an accepted
residual risk, mitigated only by every call and its URL being visible in the
transcript. A host allowlist on `web_fetch` is the thing that would close it.

**Skill bodies are an injection surface.** A skill's text is inlined into a tool
result and the prompt tells the model to follow it, and the agent can write one
into an app's own `skills/` directory — so an instruction planted in a skill
persists across sessions in a way a single poisoned `web_fetch` does not. Identity
spoofing is closed (a skill's identity is its directory name, never its
frontmatter). Provenance is not tracked. The mitigation is the same one: every
write and every load is a visible tool call, and the Skills panel shows the body.

## Reporting something

Found a hole? Open an issue. If you'd rather not describe it in public first, say
so in the issue without the details and we'll find another channel.
