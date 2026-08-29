@AGENTS.md

## Claude Code

- Path-scoped conventions live in `.claude/rules/` and load automatically when
  you open matching files. Don't re-read them preemptively.
- Use `/session-plan` to write a new `docs/plans/SESSION-N-*.md`, and
  `/session-notes` to record what was built after implementing one.
- Delegate Electron main/preload/IPC review to the `electron-security-reviewer`
  subagent, and changes to the agent's tool surface or sandboxing to
  `self-modification-auditor`. Both are read-only.
- `docs/skills/` is anyapp's *runtime* skill content, not Claude Code skills.
  When asked to change Claude Code's behavior, edit `.claude/` instead.
