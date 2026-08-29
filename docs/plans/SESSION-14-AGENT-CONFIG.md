# Session 14: Agent Configuration

## Overview

This session modernizes the repository's agent-facing configuration. The project's
real engineering conventions lived in `.cursor/rules/*.mdc`, which Claude Code
cannot read, while `CLAUDE.md` held only a thin summary. This session establishes
a canonical `AGENTS.md`, migrates every rule into path-scoped `.claude/rules/`,
captures the `docs/plans/` workflow as invocable skills, and adds two read-only
review subagents.

**Estimated scope**: Small (~1 hour)
**Prerequisites**: None — configuration only, no source changes
**Deliverable**: A `.claude/` setup where all nine former Cursor rules are visible
to Claude Code and load only when relevant

## Objectives

1. Create a canonical, cross-tool `AGENTS.md` and reduce `CLAUDE.md` to an import
2. Migrate `.cursor/rules/` to `.claude/rules/` with `paths:` frontmatter
3. Capture the session-plan / session-notes workflow as skills
4. Add subagents for Electron security and self-modification review
5. Delete `.cursor/` so there is one source of truth

---

## Task 1: Canonical AGENTS.md

Claude Code reads `CLAUDE.md`, not `AGENTS.md`. The documented pattern is a
canonical `AGENTS.md` plus a `CLAUDE.md` that imports it with `@AGENTS.md`, which
also keeps the file readable by Cursor and other agents.

`AGENTS.md` merges the old `CLAUDE.md` with `project-architecture.mdc` — the only
rule marked `alwaysApply: true` — and holds only what belongs in every session:
layout, commands, always-on conventions, safety rules, permission modes, and a
map of where everything else lives. Target is under 200 lines.

`CLAUDE.md` becomes `@AGENTS.md` plus a short Claude-specific section pointing at
rules, skills, and subagents.

## Task 2: Path-scoped rules

Seven rules move to `.claude/rules/*.md`, converting Cursor's `globs:` frontmatter
to `paths:`. Rules load only when Claude opens a matching file, so they cost no
context otherwise.

| From `.cursor/rules/` | To | `paths:` |
|---|---|---|
| `project-architecture.mdc` | folded into `AGENTS.md` | — |
| `typescript-practices.mdc` | `typescript.md` | `**/*.{ts,tsx}` |
| `react-practices.mdc` | `react.md` | `apps/electron/src/renderer/**/*.tsx` |
| `electron-security.mdc` | `electron-security.md` | `apps/electron/src/{main,preload}/**/*.ts` |
| `mcp-integration.mdc` | `mcp.md` | `packages/shared/src/sources/**/*.ts` |
| `self-modification.mdc` | `self-modification.md` | `apps/electron/src/main/agent*.ts`, `packages/shared/src/versions/**/*.ts` |
| `documentation-practices.mdc` | `documentation.md` | `docs/**/*.md` |

## Task 3: Skills

`.claude/skills/session-plan/` and `.claude/skills/session-notes/` capture the
workflow this directory already follows by hand. `.claude/skills/agent-sdk/` and
`.claude/skills/react-query/` hold the two former rules that describe code the
repo does not have — they load on demand instead of asserting themselves over
real files.

## Task 4: Subagents

`.claude/agents/electron-security-reviewer.md` and
`.claude/agents/self-modification-auditor.md`. Both read-only (`Read, Grep, Glob,
Bash`), both encoding checklists that were previously prose in the rules.

## Task 5: Cleanup

Delete `.cursor/`. Add `.claude/settings.json` with a permission allowlist for
`bun` and read-only `git` commands. Add `.DS_Store`, `CLAUDE.local.md`, and
`.claude/settings.local.json` to `.gitignore`.

---

## Verification

- `/context` in a fresh session lists `CLAUDE.md` under Memory files, with the
  `AGENTS.md` content expanded into it
- Opening `apps/electron/src/preload/index.ts` loads the `electron-security` rule;
  opening `packages/core/src/agent.ts` loads `typescript` but not `react`
- Every `paths:` pattern matches at least one real file
- `/session-plan` and `/session-notes` appear as slash commands
- Both subagents appear in the agent list
- `bun run typecheck:all` still passes — no source files change
