@AGENTS.md

## Claude Code

- Path-scoped conventions live in `.claude/rules/` and load automatically when
  you open matching files. Don't re-read them preemptively.
- Use `/session-plan` to write a new `docs/plans/SESSION-N-*.md`, and
  `/session-notes` to record what was built after implementing one.
- Delegate Electron main/preload/IPC review to the `electron-security-reviewer`
  subagent, and changes to the agent's tool surface or sandboxing to
  `self-modification-auditor`. Both are read-only.
- Load the `pi-agent` skill before changing anything under
  `apps/electron/src/main/agent/` — it carries Pi's real event shapes and the
  integration gotchas.
- Use the `run-app` skill to launch, drive, or screenshot the app. It wraps a
  Playwright REPL over the *built* app — `bun run dev` is the human path and the
  driver attaches to neither its Vite server nor its Electron.
- `docs/skills/` is Pi Taster's *runtime* skill content, not Claude Code skills.
  When asked to change Claude Code's behavior, edit `.claude/` instead.
