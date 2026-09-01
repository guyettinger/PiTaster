---
name: enhance-ui
description: Change how this app looks — layout, styling, components. Use when the request is about appearance rather than behavior.
---

# Changing the UI

## Find the Real Conventions First

This app has its own. Do not assume a component library, a design system, or a set of
color names — read for them:

1. `read package.json` for what is actually installed. Tailwind? A component library?
   A CSS-in-JS runtime? The dependency list settles it in one call.
2. `ls src` and read one existing component that is close to what you are changing.
   That file is the convention: how it exports, how it names, how it styles.
3. Check for a theme file — `tailwind.config.*`, an `index.css` with custom
   properties, a `theme.ts`. If the app defines its own colors and spacing, use those
   names rather than raw values.

An app with tokens has them for a reason. Adding `#3b82f6` next to a `--color-accent`
is how a UI stops looking like one thing.

## Making the Change

- **Match the file you are editing.** Its indentation, its export style, its naming.
- **Change the smallest thing that does the job.** Restyling a component the user did
  not ask about is not a bonus.
- **Keep contrast usable.** Text on a background needs to be readable at a glance; if
  you are unsure, go further apart rather than closer.
- **Keep the keyboard working.** Do not remove a focus outline. If you restyle one,
  it still has to be visible.
- **Don't add a dependency for something CSS already does.** A dependency costs an
  install, a bundle, and a version to keep current.

## Verifying

You cannot see the app. Run the build (read `package.json` for the script) so type and
syntax errors are caught, then tell the user what to look at — the screen, and what
should be different about it. The Preview panel is theirs, not yours.

If the app is a `react-vite` template, the dev server hot-reloads, so the user sees a
change the moment it is written.
