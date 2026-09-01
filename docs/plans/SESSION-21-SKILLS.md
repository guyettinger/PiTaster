# Session 21: Skills That Reach the Model

**Goal**: Make a skill's instructions actually arrive, discover the skills the agent
has been writing for itself, and present the whole system honestly.

## The problem

Three populations of skill, failing in complementary ways.

| Population | Lives in | In the manifest? | Body reachable? | Visible in the app? |
|---|---|---|---|---|
| Claude Code | `.claude/skills/` | n/a — different agent | n/a | no |
| Workspace | `~/.anyapp/skills/` | **yes** | **no** | yes |
| App | `<app-root>/skills/` | **no** | yes | **no** |

**Workspace skills were advertised and unreachable.** `session.ts` handed them to Pi;
Pi's `formatSkillsForPrompt` emitted `<available_skills>` with each skill's absolute
`<location>` and the instruction *"Use the read tool to load a skill's file."* Every one
of those paths is under `~/.anyapp/skills`, `read` is in `PATH_TOOLS`, and
`checkConfinement` refuses any path outside the app root. The model was shown a menu it
was blocked from ordering from. No skill body had ever reached a model.

**App skills worked, and nothing discovered them.** Working inside `pony-pony-pony`, the
agent hit that wall and built its own system — `skills/` in the app root, registered by a
hand-maintained table in the app's `AGENTS.md`. Its `NOTES.md` says why:

> *"Agent can only write inside the app root, so project skills live in `skills/` (not
> `~/.anyapp/skills/`). AGENTS.md tells the agent to read them."*

Four skills, git-tracked, specific, inside the confinement boundary — the best skills in
the system, and the Skills panel could not see them.

**The seeded content misled the model.** `manage-versions` documented nine `version_*`
tools; the real names are `create_branch`, `switch_branch`, `list_branches`,
`get_history`, `rollback`, `git_status`, and `version_merge`/`version_diff` do not exist
at all. `enhance-ui` told the model to import from shadcn/ui, which the repo has never
contained. `self-modify` described anyapp's own monorepo, which the confined agent cannot
reach. `seedSkills` never overwrites, so every install kept them forever.

**`@mention` was placebo.** The panel typed `@name ` into the composer, the composer
advertised it, `extractSkillMentions` existed — and nothing in `main/` ever called it.

**And `skills:delete` had a path traversal.** `join(skillsDir, name)` with an unvalidated
name, then `fs.rm(..., { recursive: true })`.

## What to build

1. **`load_skill`** — a tool taking a *name*, resolving the two roots itself. No path
   argument, so nothing for `checkConfinement` to refuse and no way to spell one that
   reaches another file. Classified with `read`. Visible in the transcript.
2. **anyapp's own manifest** — `renderSkillManifest`, naming `load_skill`. Pi's is
   suppressed, because its wording is now wrong.
3. **Discover `<app>/skills/`** — adopt the convention the agent invented, and rewrite
   `create-skill` to teach it.
4. **Per-app enable/disable** — `SubApp.disabledSkills`, so turning a skill off removes
   its description from every request.
5. **A Skills page in two sections**, drawn in the two registers a skill is actually
   received in: the always-sent description and the on-demand body, each with its token
   count. Authoring in place. A brass trace on any skill the agent loaded this chat.
6. **Correct the seeds**, and migrate installs that still carry the bad copies —
   replacing only bodies that match byte-for-byte what anyapp shipped.
7. **Make `@` real** — completion in the composer, and a directive appended in main.

## Verification

- `bun run typecheck:all`, `bun run build`, `bun test`.
- The assembled manifest for `pony-pony-pony` lists all four app skills first.
- Drive the built app: the agent loads a skill, the transcript shows it, the row takes
  the brass trace, and the header's token count tracks the toggles.
- Create, edit and delete a skill in each scope; app-scoped changes commit to the app.
- `skills:delete` rejects `../..`.
- `self-modification-auditor` and `electron-security-reviewer` review the change.
