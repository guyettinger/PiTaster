---
name: session-notes
description: Record what was actually built for a session in docs/plans/SESSION-N-NOTES.md and mark it complete in the index. Use after finishing a session's implementation.
---

# Write Session Notes

The counterpart to `/session-plan`. The plan says what was intended; the notes
say what shipped, including where the two diverged.

## Steps

1. **Identify the session.** Find the plan document being closed out and read it,
   so the notes can be honest about what changed versus what was planned.

2. **Review the actual diff.** `git log` and `git diff` since the session started
   — the notes should reflect the code, not the plan.

3. **Write `docs/plans/SESSION-N-NOTES.md`.** Follow the structure of the existing
   notes (see `docs/plans/SESSION-13.1-NOTES.md`):

   ```markdown
   # Session N Notes: Title

   **Date**: YYYY-MM-DD
   **Status**: ✅ Complete
   **Duration**: ~45 minutes

   ## What Was Built

   Short paragraph on the outcome.

   ### Components Created

   1. **Name** (`path/to/file.ts`)
      - Specific capability
      - Specific capability

   ## Decisions

   Choices made during implementation and why.

   ## Deviations from Plan

   What was planned but done differently, or skipped, and why.

   ## Gotchas

   Non-obvious things worth remembering — what surprised you.
   ```

4. **Use absolute dates.** `2026-08-29`, not "today".

5. **Record what was left undone.** If part of the plan was skipped, say so
   explicitly. Silently dropping scope is what makes these notes untrustworthy.

6. **Update the index.** In `docs/plans/README.md`, change the session's status to
   `Complete` and link the notes:

   ```markdown
   | [N. Title](SESSION-N-TITLE.md) | Focus | Deliverable | Complete | [Notes](SESSION-N-NOTES.md) |
   ```

## Notes

- The Gotchas section is the highest-value part — it's the thing that isn't
  derivable from reading the diff later.
