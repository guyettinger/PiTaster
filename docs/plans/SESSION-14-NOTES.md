# Session 14 Notes: Agent Configuration

**Date**: 2026-08-29
**Status**: ✅ Complete
**Duration**: ~1 hour

## What Was Built

Replaced the repo's pre-`.claude/` agent configuration with the current Claude
Code layout: a canonical `AGENTS.md`, path-scoped rules, on-demand skills, and
two review subagents. `.cursor/` is gone; there is now one source of truth.

### Files Created

1. **`AGENTS.md`** (110 lines) — canonical always-on context
   - Merges the old `CLAUDE.md` with `project-architecture.mdc`
   - Corrects the claim that the app is built with the Claude Agent SDK
   - Warns that `docs/skills/` is app runtime content, not Claude Code skills

2. **`CLAUDE.md`** — rewritten to `@AGENTS.md` plus a Claude-specific section

3. **`.claude/rules/`** — six path-scoped rules migrated from `.cursor/rules/`
   (`typescript`, `react`, `electron-security`, `mcp`, `self-modification`,
   `documentation`)

4. **`.claude/skills/`** — `session-plan`, `session-notes` (this repo's own
   `docs/plans/` workflow), plus `agent-sdk` and `react-query` as reference

5. **`.claude/agents/`** — `electron-security-reviewer`,
   `self-modification-auditor`; both read-only

6. **`.claude/settings.json`** — permission allowlist for `bun` and read-only `git`

## Decisions

**`@AGENTS.md` import over a symlink.** Both work. The import allows a
Claude-specific section below it and doesn't require Developer Mode on Windows.

**Rules *and* subagents, split by function.** Path-scoped rules carry the
conventions; subagents carry the two review checklists, which are verbose,
self-contained, and better run in isolated context.

**No hooks.** A `PostToolUse` typecheck hook was the obvious candidate, but
`typecheck:all` runs `tsc` across three workspaces and would fire on every edit.
Left as an opt-in `Stop` hook for later.

## Deviations from Plan

Two of the nine Cursor rules were **not** migrated as rules, because they
describe code this repo does not have. Both became on-demand skills instead:

- `react-query-practices.mdc` — `@tanstack/react-query` is not a dependency and
  appears nowhere in the source
- `claude-agent-sdk.mdc` — `@anthropic-ai/claude-agent-sdk` is not installed; the
  app uses raw `@anthropic-ai/sdk` `client.messages.stream`

## Gotchas

**Three rules had globs that never matched anything.** `claude-agent-sdk.mdc`
scoped to `**/{agent,permissions}/**/*.ts` and `self-modification.mdc` to
`**/agent/**/*.ts` — there are no such directories; the code is at
`apps/electron/src/main/agent.ts`. These rules had been silently inert in Cursor.
Verify every `paths:` pattern against real files, not against intent.

**Rules contradicted the codebase.** `react-practices.mdc` mandated kebab-case
filenames while every component is PascalCase, and prescribed shadcn/ui, `cn()`,
and `@/components/ui` — none of which exist. Conflicting instructions measurably
degrade adherence, so these were corrected to match reality rather than ported.

**`@` in markdown is an import.** In `CLAUDE.md` and anything it imports, a bare
`@anyapp/core` outside backticks is parsed as a file import. Every package name
in `AGENTS.md` is wrapped in backticks for this reason.

**Naming collision.** `docs/skills/*/SKILL.md` are anyapp's *runtime* skills,
loaded by `SkillsLoader` from `~/.anyapp/skills`. They look exactly like Claude
Code skills and are not. Both `AGENTS.md` and `CLAUDE.md` call this out.

## Left Undone

Deliberately out of scope — the app's own agent runtime is unchanged:

- `@anthropic-ai/sdk` is pinned at `^0.36.0`, many majors behind
- `apps/electron/src/main/agent.ts:1104` hardcodes `claude-sonnet-4-20250514`
- 25 tools are hand-rolled where the Agent SDK would replace most of the custom
  permission and streaming plumbing; `.claude/skills/agent-sdk/SKILL.md` is the
  reference for that migration
