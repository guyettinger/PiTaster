---
name: working-notes
description: Keep a NOTES.md checklist in the app root for any task of more than a few steps, so the plan survives when the conversation is summarized. Use before starting multi-step work, and after each step.
---

# Working Notes

Before starting a task of more than a few steps, write the plan to `NOTES.md` in
the app root. Update it as you go.

## Why This Matters Here

You run on a local model with a small context window. When the conversation
outgrows it, your earlier messages are replaced by a summary — and a summary is
lossy in exactly the way that hurts most: it keeps the gist and drops the
specifics. The file you were halfway through editing, the two things you already
tried, the step you were on.

`NOTES.md` is on disk. Summarizing the conversation does not touch it. Re-reading
one short file costs a fraction of what redoing the work costs.

You will be told when your history has been summarized. Read `NOTES.md` then.

## The Shape

Keep it short — this file is read often, and a long one costs the context it was
meant to save.

```markdown
# Goal

Add a dark mode toggle to the settings page.

## Steps

- [x] Read src/pages/Settings.tsx to find where controls are rendered
- [x] Add a `theme` field to the settings store in src/store/settings.ts
- [ ] Render the toggle — currently editing src/pages/Settings.tsx
- [ ] Apply the class to the root element in src/App.tsx

## Notes

- Tailwind is configured with `darkMode: 'class'`, so the toggle sets a class on
  `<html>`, not a CSS variable.
- `src/store/settings.ts` persists to localStorage already; reuse that.
```

## Rules

1. **Write it before you start**, not after you are lost.
2. **Tick a step the moment you finish it**, in the same turn. A checklist that
   lags is worse than none — it will tell you to redo work you already did.
3. **Record what you learned**, not just what you did. The constraint you
   discovered three steps ago is the thing a summary will drop.
4. **Keep it under a screen.** Delete finished sections once the whole task is
   done.
5. **Skip it for one-step tasks.** Renaming a variable does not need a file.

`NOTES.md` is committed like any other file, so it is versioned with the work and
the user can read it to see where you are.
