# Session 21 Notes: Skills That Reach the Model

**Date**: 2026-09-01
**Status**: ✅ Complete

## What Was Built

The skill system was disconnected at both ends, and the evidence was sitting in the
user's own chat history: sessions named `@plan-feature make the world twice as large`,
`/plan-feature make the pony's legs move`, `what skills do I have access to?`. Three
different guesses at an invocation syntax, none of which did anything.

### The two failures were complementary

**Workspace skills were advertised and unreachable.** Pi's `formatSkillsForPrompt`
emits `<available_skills>` carrying each skill's absolute `<location>` and the line
*"Use the read tool to load a skill's file."* Every one of those paths is under
`~/.pitaster/skills`; `read` is in `PATH_TOOLS`; `checkConfinement` refuses any path
outside the app root. So the model was shown a menu and refused every item on it. No
skill body had ever reached a model — 14.6 KB of instructions that had never once been
read.

**App skills worked and nothing discovered them.** Confined to the app root, the agent
had worked this out for itself and built a parallel system. `pony-pony-pony/NOTES.md`,
written by the agent:

> *"Agent can only write inside the app root, so project skills live in `skills/` (not
> `~/.pitaster/skills/`). AGENTS.md tells the agent to read them."*

Four skills — `plan-feature`, `implement-plan`, `add-game-system`, `add-rendering` —
git-tracked, specific to the app, inside the boundary so `read` succeeds, and registered
by a hand-maintained markdown table. The best skills in the system, invisible to the
Skills panel.

### `load_skill`, not a hole in confinement

`agent/skill-tools.ts` takes a **name**, never a path, and resolves it against the two
roots itself. There is no argument for `checkConfinement` to decide on and no way to
spell one that reaches another file, so the boundary is untouched. It is classified with
`read` in `FILE_TOOLS`: it opens one file the user put in their own skills directory,
and it is the tool that *replaced* pointing the model at that file and having the gate
refuse it — treating it more strictly would restore the original bug.

The load is also visible in the transcript, which pointing at a path never was.

Pi's manifest is now suppressed rather than extended (`skillsOverride` returns no
skills), because its wording is wrong the moment `read` is not the way in.
`renderSkillManifest` in `@pitaster/shared` renders Pi Taster's, and the same function
measures what each entry costs — so the number the UI shows is measured on the text
actually sent rather than guessed.

### `<app>/skills/` is now Pi Taster's convention

`loadSessionSkills` scans both roots. App skills are listed first, win a name collision,
and the workspace copy is kept and marked **shadowed** rather than hidden — a user
looking for why their workspace skill has no effect needs to see it. Nothing else
discovers this path: Pi's project scope is `.pi/skills` and `DefaultResourceLoader` runs
with `includeDefaults: false`. `create-skill` was rewritten to teach it, so the
workaround became the documented path.

### The seeds were teaching the model a fake API

`manage-versions` documented nine `version_*` tools. The real names are `create_branch`,
`switch_branch`, `list_branches`, `get_history`, `rollback`, `git_status` — and
`version_merge` and `version_diff` do not exist at all. `enhance-ui` told the model to
import from shadcn/ui, which this repo has never contained. `self-modify` and
`connect-source` described work a confined agent cannot do.

Rewriting them was not enough, because `seedSkills` never overwrites: every existing
install would have kept the bad copies forever. `SUPERSEDED_SEEDS` carries the exact
bodies Pi Taster shipped, and a file is corrected — or deleted, where the honest correction
is that the skill should not exist — only when it still matches one byte for byte. A body
that differs by a character is left alone and flagged **Outdated** in the panel. That
migration ran on first launch here: six corrected or removed, and the two that were
already right (`lookup-docs`, `working-notes`) untouched.

`docs/skills/` is now the real source: `bun run sync:skills` regenerates
`seed-content.ts`, and a test fails if they drift. They used to be kept in step by hand.

### The panel says what a skill costs

A skill is not one document. Its **description** rides in every request for the whole
session and is the only text a task is matched against; its **body** costs nothing until
it is loaded. Nothing said so, and the seeded skills were written like documentation — a
title and a summary, no trigger words.

So the row is drawn in those two registers, each labelled and each carrying its token
count, and the page header states the running total: *"10 of 10 active · 620 tokens in
every request"*. Turning a skill off drops that number by exactly its manifest cost,
which is what makes it a decision rather than a preference.

Colour follows the shell's existing rule. App skills are **patina** — they are versioned
and roll back with the app. A skill the agent has **loaded in this chat** takes the brass
leading bar, because loading is the one thing on that page that is an action rather than
a setting. Everything at rest is neutral.

## Files Created

- `apps/electron/src/main/agent/skill-tools.ts` — `load_skill`
- `apps/electron/src/main/agent/skills.ts` — the two roots, in one place
- `packages/shared/src/skills/manifest.ts` — the manifest, and the cost measurement
- `packages/shared/src/skills/library.ts` — resolving the two roots against each other
- `packages/shared/src/skills/tokens.ts`, `superseded-seeds.ts`
- `apps/electron/src/renderer/src/hooks/useSkills.ts`
- `apps/electron/src/renderer/src/components/skills/` — `SkillsPanel`, `SkillSection`,
  `SkillRow`, `SkillEditor`, `SkillMentionMenu`
- `scripts/generate-seed-content.ts`

## What the Screenshots Caught

Three things only showed up in the running app.

1. **`IN EVERY PROMPT` on every row became wallpaper.** Ten identical eyebrows stop
   being read. The label now appears only where it varies — the load trace, a shadowed
   skill — or when the row is expanded, where it contrasts with `LOADED ON DEMAND`. The
   page header states the rule once instead.
2. **Descriptions ran the full 1400px.** Capped with `max-w-prose`, per the renderer
   rule about running prose.
3. **The stretched click target covered the expanded body.** `after:absolute
   after:inset-0` resolved against the `<li>`, so clicking the instructions — or
   selecting text in them — collapsed the row. Scoped to the header.

A driver artefact worth recording: the two-step **Delete → Confirm** appeared broken
because the REPL's round-trip exceeded the 3-second confirm window. Clicking and
observing inside one `evaluate` showed it working.

## Also Fixed

- **`skills:get` and `skills:delete` had a path traversal.** Both joined an unvalidated
  `name` onto the skills root and `delete` did `fs.rm(..., { recursive: true })`, so
  `../..` escaped. `isValidSkillName` is enforced in the loader and at the IPC boundary,
  and no renderer-supplied path reaches the filesystem — the app root is resolved from
  the active app in main.
- **`@mention` was placebo.** `extractSkillMentions` and `buildSystemPrompt` had zero
  callers. The composer now completes a mention against the real skill set, and
  `withSkillDirectives` appends an explicit instruction for names that resolve. The
  user's own text is left as written.
- **Panel edits now commit.** The row says **Versioned**, which was only true for the
  agent's writes — auto-commit is a `tool_result` hook and a panel edit passes through no
  tool. `autoCommitSkillChange` covers it, and `VersionManager.commit` gained `removed`
  so a deletion stages as a removal; `git.add` throws `ENOENT` on a missing file, which
  would have left the path in `HEAD` for the next rollback to restore.
- **`updateApp` silently dropped unlisted metadata fields.** It rebuilds the metadata
  object from scratch, so `disabledSkills` had to be carried explicitly. Documented.
- **Dead composer plumbing removed.** `externalInput` / `onExternalInputChange` /
  `inputRef` existed only so the Skills panel could type into the chat; the composer owns
  its own input now.
- **The Help page described a skill that never existed** (`@enhance-ui` and "the
  component library"). Rewritten to describe the two libraries and the third population —
  Claude Code's `.claude/skills/`, which belongs to a different agent and never appears
  in the app.

## Security Review

Both required subagents reviewed the change. `electron-security-reviewer` confirmed the
path traversal is closed at both layers and found nothing above low severity;
`self-modification-auditor` found two, both fixed here:

1. **A skill could impersonate another.** `toSkill` took its name from the file's
   frontmatter. A file at `skills/anything/SKILL.md` declaring `name: manage-versions`
   would shadow the workspace skill of that name and be what `load_skill` returned — and
   the agent can write that file under `acceptEdits`, possibly from text it just fetched.
   One auto-approved write, and every later session loads it. A skill's identity is now
   its **directory name**, which cannot contain a separator and cannot be forged from
   inside a file. Three tests cover it.
2. **A failed commit was swallowed.** `.claude/rules/self-modification.md` is explicit
   that a git failure must not lose the write but must be reported, and `commitAppSkill`
   discarded the outcome — so the panel would call an uncommitted skill *Versioned*.
   `skills:save` and `skills:delete` now return a `SkillLibraryUpdate` carrying a warning,
   which the panel shows in brass. It is deliberately not an error: the change did happen,
   and reporting it as a failure would have the user redo saved work.

Their third note — that skill bodies are a durable, agent-writable instruction surface —
is now documented as an accepted residual risk in `AGENTS.md` and in a new section of
`.claude/rules/self-modification.md`.

## Verification

- `bun run typecheck:all` clean, `bun run build` clean, `bun test` 226 pass.
- The assembled manifest for `pony-pony-pony` lists all four app skills first, then the
  enabled workspace ones, and names `load_skill`.
- Drove the built app on `qwen3.8:27b-mlx`: asked for a weather system, and the model
  answered *"I'll plan this first. Let me load the planning skill"*, called `load_skill`
  → `plan-feature`, then read `docs/architecture.md` and `docs/game-systems.md` — the two
  files that skill's body tells it to read. The body reaching a model, for the first
  time.
- The row took the brass trace and `LOADED 1× THIS CHAT`.
- Toggling `create-skill` off: header went 10 → 9 active and 620 → 553 tokens, exactly
  its 67-token entry; `disabledSkills` persisted to `.pitaster-meta.json`; the manifest
  dropped it.
- Wrote, edited and deleted an app skill from the panel; each produced a commit
  (`write:`/`delete: skills/verify-build/SKILL.md`) and the working tree came back clean.
- The editor refused a malformed name.
- The seed migration ran on launch and left `lookup-docs` and `working-notes` alone.

**This session wrote to `~/.pitaster/`**: the seed migration corrected four skills and
removed two, a `Weather System Planning` chat session was created in `pony-pony-pony`,
and that app gained two commits from the create/delete round trip.
