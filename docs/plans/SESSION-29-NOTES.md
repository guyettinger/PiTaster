# Session 29 Notes: Key Lime Pi

**Date**: 2026-09-05
**Status**: ✅ Complete
**Duration**: ~1 hour

## What Was Built

The second rename. The mark had been a key lime pie since Session 30's crust rim and
Session 31's palette, but the name still said Pi Taster. This catches the name up:
**Key Lime Pi** as the display name and `keylimepi` as the slug everywhere `pitaster`
was used — the npm scope, the workspace directory, the per-app metadata file, the
inspector globals, the Monaco and dockview theme ids, the MCP client name, the commit
author.

233 files changed. The substitution was the easy part; the work was the on-disk
migration and the two defects the *previous* rename left behind.

### Components Changed

1. **`migrate-workspace.ts`** — one legacy tier becomes a chain
   - `LEGACY_WORKSPACE_DIRS = ['.pitaster', '.anyapp']` and
     `LEGACY_META_FILES`, replacing the singular `LEGACY_WORKSPACE_DIR` / `LEGACY_META_FILE`
   - `migrateWorkspace` loops the roots; `migrateAppMeta` tries every legacy name;
     `migrateAppSessions` takes `legacyAppPaths: string[]` and drains each
   - An install that never launched Pi Taster reaches `~/.keylimepi` in one launch
2. **`context-trim.ts`** — `LEGACY_TRUNCATION_MARKER` becomes `LEGACY_TRUNCATION_MARKERS`,
   holding both `'…[Pi Taster truncated'` and `'…[anyapp truncated'`
3. **`superseded-seeds.ts`** — the two shipped `create-skill` bodies appended, landing a
   correction that has never reached an install (see Gotchas)
4. **`apps/manager.ts`** — the duplicated `AUTHOR` deleted in favour of `COMMIT_AUTHOR`
5. **`useSessionChanges.ts`** — `HOUSEKEEPING_FILES` grows to three metadata names
6. **`AGENTS.md`** — "Names that must not be rebranded" rewritten for two renames, plus
   the two lessons below

## Decisions

- **The legacy roots are ordered newest first, and that is load-bearing.**
  `moveMissingEntries` fills gaps and never overwrites, so on a machine carrying two
  legacy roots whichever is merged first wins every collision. Oldest-first would
  silently restore an abandoned `~/.anyapp` over the `~/.pitaster` workspace actually in
  use. There is a test that fails if the array is reversed — verified by reversing it.
- **`SUPERSEDED_MARKER` gets no legacy list.** Its idempotence is exact equality against
  a freshly computed marker, not a prefix test, so an old marker is rewritten once and
  then matches. One prefix-cache invalidation on a resumed conversation's first seal,
  against a permanent list of dead names to carry.
- **The substitution ran as eight ordered passes**, narrowest first, display name last —
  then a grep for the display name appearing inside a path, email or scope. That grep is
  the whole reason this rename did not repeat the `agent@Pi Taster.local` bug.

## Deviations from Plan

- The plan hedged on the legacy-root loop order ("oldest first ... reversing the loop if
  not"). Newest-first is correct, for the reason above.
- Renaming the GitHub repo and the local directory is left to the user; the commands are
  in the plan.

## Gotchas

- **The previous rename's `create-skill` correction never reached a single install, and
  this one nearly repeated it.** `dcbea2e` edited `docs/skills/create-skill/SKILL.md`
  (`~/.anyapp/skills` → `~/.pitaster/skills`) and appended nothing to `SUPERSEDED_SEEDS`.
  `seedSkills` never overwrites, so every install kept the anyapp text — flagged Outdated
  forever with no way to converge. Verified byte-exactly on this machine before the
  rename: the on-disk body matched the anyapp-era shipped body exactly. Both shipped
  bodies are now superseded, and `seed.test.ts` asserts a rename cannot strand a third.
- **A blind display-name pass produced an email with a space in the domain.** The last
  rename left `email: 'agent@Pi Taster.local'` in `apps/manager.ts` and test fixtures
  naming `/Users/someone/.Pi Taster/apps`. Both were still there at the start of this
  session, and a single case-insensitive sweep would have carried them forward as
  `agent@Key Lime Pi.local`.
- **The legacy-marker test had been vacuous since it was written.** `truncateResult`
  returns early on a body that already fits (`if (body.length <= limit) return text`), and
  the fixture was three lines — so it passed whether or not the marker was recognised.
  Confirmed by deleting the marker and watching it stay green. The fixture is now 500
  lines, and deleting the marker fails it.
- **A rehearsal in `/tmp` does not exercise the transcript step unless you re-home it
  first.** Pi slugs a session directory from the app's *absolute* path, so a copy of
  `~/.pitaster` at `/tmp/rehearsal` still carries `--Users-guyettinger-.pitaster-apps-x--`
  directories that no `/tmp`-rooted migration will ever look for. The rehearsal renamed
  the session dirs and rewrote each header's `cwd` to the copy's paths first; only then
  did it prove anything.
- **Rebuild `packages/shared` before running tests after a rename.** The electron tests
  import `@keylimepi/shared`, which resolves to `dist/` — a stale build failed one test
  with `Received: "Pi Taster Agent"` long after the source said otherwise.

## Verification

- `bun run typecheck:all` clean; **592 tests pass**, 0 fail
- **Migration rehearsal on a re-homed copy of the real 393 MB workspace**: 82 of 82
  transcripts moved *and* listed by Pi's own `SessionManager.list`, three apps with
  committed metadata renames and clean `git status`, branches intact, second run a no-op
- **The real migration, run by launching the built app**: `~/.pitaster` gone,
  `~/.keylimepi` in place, 82 transcripts, all three apps clean, chat history and per-app
  dock layouts preserved, changed-files strip empty
- `~/.keylimepi/skills/create-skill/SKILL.md` now reads `~/.keylimepi/skills` — the seed
  repair landing on a real install
- **One agent turn end to end** on the migrated workspace: model loaded at 65,536 tokens,
  thinking rendered, answer correct, session auto-titled; a second turn's approval prompt
  raised and denied
- All six `docs/images/*.png` re-shot at the original 2400×1520. They were stale by more
  than the rename — they still showed the pre-Session-28 nav rail with Workspace and
  Skills as destinations. Captions were adjusted where the new frame shows something
  different; `logo.png` is unchanged, being the mark rather than a screenshot.
- A pre-rename backup is at `~/keylimepi-backups/dot-pitaster-before-rename`

## Left Undone

- `ModelTab`'s daemon health line renders "Ollama is running.  is loaded." with the model
  name missing. Verified **not** caused by this rename — `git diff` on that file touches
  only the import and one hint string — so it is left as found rather than folded into a
  rename commit.
