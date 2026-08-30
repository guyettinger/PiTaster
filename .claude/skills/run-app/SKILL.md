---
name: run-app
description: Use when asked to run, start, launch, or screenshot the anyapp desktop app, to click through its UI, or to confirm a change works in the real app rather than only in typecheck.
---

# Running anyapp

anyapp is an Electron GUI. An agent cannot see a window, so drive it through the
Playwright REPL at `.claude/skills/run-app/driver.mjs`, wrapped by
`drive.sh`. Launch takes ~15s, so keep one REPL alive and send it commands
rather than relaunching per interaction.

All paths below are relative to the repo root.

## Prerequisites

```bash
bun install                 # playwright-core is a root devDependency
bun run build               # REQUIRED - the driver launches out/main/index.mjs
```

The driver launches the **built** app, not `bun run dev`. After changing
renderer or main source, rebuild before relaunching or you will screenshot the
old code.

For anything involving the agent (chat, tool calls, approvals) Ollama must be
running with a tool-calling model:

```bash
ollama serve
curl -s localhost:11434/api/tags     # confirm a model is loaded
```

The UI renders fine without Ollama — only the agent turns fail.

## Run it

```bash
cd .claude/skills/run-app
./drive.sh start                                  # boots the REPL + launches
./drive.sh 'size 1400x900' 'shot 01-apps'
./drive.sh 'open-app Magic 8 Ball' 'shot 02-chat'
./drive.sh stop
```

Each argument is one REPL line; quote anything with spaces. Screenshots land in
`/tmp/anyapp-shots` (override with `SCREENSHOT_DIR`).

**Then actually open the PNG and look at it.** A blank or half-painted frame is
a failed launch, not a screenshot.

## Commands

| Command | What it does |
|---|---|
| `launch` | Launch the built app (`drive.sh start` does this for you) |
| `size <WxH>` | Resize + reposition the window |
| `shot [name]` | **Native** window capture incl. traffic lights (macOS) |
| `ss [name]` | Renderer-only screenshot (cross-platform, no chrome) |
| `controls` | Dump every button/input with its label — find targets with this |
| `click <sel>` / `click-text <text>` / `click-aria <label>` | Click |
| `type <text>` / `press <key>` / `wait <sel>` / `sleep <ms>` | Input + waiting |
| `eval <js>` / `text [sel]` | Evaluate in the page / dump innerText |
| `bounds` | Print the window's current bounds |
| `quit` | Close the app and exit |

anyapp-specific:

| Command | What it does |
|---|---|
| `open-app [name]` | Open a sub-app from the Apps list (first one if omitted) |
| `nav <Apps\|Skills\|Help\|Settings>` | Switch main destination |
| `panel <History\|Terminal\|Preview>` | Toggle a docked panel |
| `panel-height <px>` | Resize the bottom dock (150–600) |
| `new-chat` | Start a new chat session |
| `ask <message>` | Send a message to the agent |
| `approve` / `deny` | Answer the inline approval prompt |
| `mode <label>` | Set permission mode (`Explore`, `Ask to edit`, `Auto edit`, `Auto — all`) |

## Driving the agent

A local model turn takes **40–90s**, and the approval gate blocks mid-turn.
The rhythm is send → poll → approve → poll:

```bash
./drive.sh 'open-app Magic 8 Ball' 'new-chat'
./drive.sh 'ask Read src/App.tsx and tell me what this app does.'
sleep 60 && ./drive.sh 'text'          # look for "Approval Required"
./drive.sh 'approve'
sleep 90 && ./drive.sh 'text'          # the finished answer
```

Use `mode 'Auto edit'` to skip file-operation prompts. `bash` still prompts in
every mode except `Auto — all` — that is the permission gate working, not a bug.

## Gotchas

- **`bun run dev` is the human path, not the agent path.** It starts a Vite dev
  server and its own Electron; the driver attaches to neither. Build, then drive.
- **`shot` vs `ss`.** `page.screenshot()` renders the DOM only — the header has a
  gap where the traffic lights should be, because macOS draws them over the
  window. `shot` shells out to `screencapture -R` using the bounds reported by
  `BrowserWindow.getBounds()`, so it captures the real window. Use `shot` for
  anything a human will look at.
- **Keep the window within the screen.** `screencapture -R` clips at the display
  edge, silently. On a 1080p display `availHeight` is ~947, so a window taller
  than ~910 at y=40 loses its bottom rows. Check with `eval screen.availHeight`.
- **App cards need `open-app`, not `click-text`.** The card is a `<button>` whose
  text is spread across nested divs; `click-text` matches an inner div and the
  click does nothing. `open-app` finds the button by its `cursor-pointer
  text-left` class.
- **Most chrome is icon-only.** Nav rail items, panel toggles, and header buttons
  carry `aria-label`/`title` and no text. Run `controls` and match on the label.
- **The bottom dock resizes by drag only.** There is no click or keyboard
  affordance, so `panel-height` synthesises mousedown → mousemove → mouseup
  against the `[aria-label="Resize panel"]` handle.
- **Electron steals stdin.** The driver reads `/dev/stdin` through its own fd for
  exactly this reason. Don't "simplify" it back to `process.stdin`.
- **The sub-app dev server outlives the app.** If you press Run/`Run`, kill the
  port afterwards: `lsof -ti:5200 | xargs kill`.
- **Driving the app writes to `~/.anyapp/`.** New chat sessions, approval
  records, and any file the agent edits are real and persist. Say so when you
  report back.
- **No tmux on this machine.** That is why `drive.sh` uses a FIFO instead of the
  usual `tmux send-keys` pattern.
- **Background jobs must be fully detached.** A backgrounded pipeline that still
  holds the caller's stdout/stderr blocks the calling tool until it times out,
  even after the script itself has exited. `drive.sh start` runs the REPL under
  `nohup` with all three streams redirected for this reason — don't "simplify"
  it back to `( … & )`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ERROR: no build` | `bun run build` from the repo root |
| Launch timeout | Stale driver holding the FIFO — `./drive.sh stop`, then `start` |
| `not started` | Run `./drive.sh start` first |
| Screenshot cut off at the bottom | Window taller than the display — shrink it |
| Agent never answers | Ollama down, or the model has no tool support |
| `NOT_FOUND` from a click | Run `controls` and match the real label |
