---
name: session-plan
description: Write a new implementation plan in docs/plans/ following this repo's SESSION-N document convention. Use when starting a new feature or breaking work into sessions.
---

# Write a Session Plan

This repo plans work as numbered sessions, each producing a working, committable
checkpoint. Every session has a plan document and, after implementation, a notes
document. `docs/plans/README.md` is the index.

## Steps

1. **Pick the number.** Read `docs/plans/README.md` and find the highest existing
   session number. Use the next integer. If the work is a sub-part of an existing
   session, use a decimal (`SESSION-13.4-…`) and list it under that session's
   sub-session table instead of the main table.

2. **Scope it to one checkpoint.** A session should be small enough to finish and
   commit in one sitting — roughly 1–3 hours. If it isn't, split it into
   sub-sessions the way Session 6, 8, and 13 are split, and write a short parent
   document that indexes them.

3. **Write `docs/plans/SESSION-N-TITLE.md`.** Title in `SCREAMING_SNAKE_CASE`.
   Follow the structure used by the existing plans (see
   `docs/plans/SESSION-13.1-INSPECTOR-OVERLAY.md` for a good example):

   ````markdown
   # Session N: Title

   ## Overview
   What this session builds and why.

   **Estimated scope**: Small (~1 hour)
   **Prerequisites**: Session X complete
   **Deliverable**: A concrete, demonstrable outcome

   ## Objectives
   1. …
   2. …

   ---

   ## Task 1: Name

   ### path/to/file.ts

   ```typescript
   // the actual code to write
   ```

   ## Task 2: …

   ---

   ## Verification
   How to confirm the session actually works, end to end.
   ````

4. **Be concrete.** These plans carry real code blocks with real file paths, not
   descriptions of code. Read the files you're changing first so the snippets fit
   the existing style.

5. **Update the index.** Add a row to the session table in
   `docs/plans/README.md` with status `Planned`:

   ```markdown
   | [N. Title](SESSION-N-TITLE.md) | Focus | Deliverable | Planned | |
   ```

## Notes

- Plans describe intent; they are not updated as implementation drifts. What
  actually happened goes in the notes document — use `/session-notes` for that.
- Follow the conventions in `.claude/rules/documentation.md` for naming and structure.
