# Session 17: Shell Design Pass

## Overview

The app shell had grown by accretion and the navigation no longer described the
product. A 56px rail of nine identical emoji buttons drove three unrelated
behaviours; the two panels that were "contextual" were gated on the wrong thing;
and `titleBarStyle: 'hiddenInset'` was set with no drag region anywhere, so the
window could not be moved and the traffic lights sat on top of the first nav
button.

This session rebuilds the shell around one rule — **the rail holds what exists
without an app, a second column holds what belongs to the open app** — and gives
anyapp a visual identity: design tokens, two bundled typefaces, one icon set, a
logo, and a dock icon.

**Estimated scope**: Large
**Prerequisites**: Session 8 (preview/terminal panels), Session 11 (chat sessions), Session 16 (MCP tools)
**Deliverable**: A coherent, draggable, legible app shell with MCP sources moved into Settings

## Why This Matters

- **The rail conflated three behaviours.** `App.tsx` drove `mainPanel`
  (destinations), `rightPanel` (a side dock) and `bottomPanel` (a bottom dock)
  from one button component, with labels only in `title=` tooltips. Nothing about
  a button told you whether clicking it would replace the view or add to it.
- **The contextual gating was backwards.** Skills and Sources were both
  `disabled={!activeApp}`, yet `SkillsLoader` and `SourceManager` are both
  constructed from `configDir` in `ipc.ts` — they are workspace-global data under
  `~/.anyapp`, unrelated to the open app. Meanwhile History, Terminal, and Preview
  really are app-scoped and sat in the same undifferentiated group.
- **The window could not be dragged.** A repo-wide grep for `app-region` returned
  zero hits.
- **There was no identity.** `globals.css` was one line. Every colour was an ad-hoc
  stock Tailwind neutral or `blue-600`, split across two icon systems (literal
  emoji and hand-rolled heroicons paths).

## Design System

Thesis: **an instrument case in warm graphite, with brass controls and verdigris
where it has been handled.** Brass is the colour of the agent acting — focus,
primary action, the permission gate. Patina is the colour of history and
reversibility — commits, branches, a running app. Nothing else in the UI is
saturated, which is what lets those two read.

| Token | Value | Role |
|---|---|---|
| `--color-ground` | `#121316` | App ground |
| `--color-panel` | `#191b1f` | Rail, context column, docked panels |
| `--color-raised` | `#23262b` | Inputs, cards, hover |
| `--color-line` | `#2e323a` | Hairlines |
| `--color-bone` | `#e7e5e0` | Primary text |
| `--color-ash` | `#878d97` | Secondary text |
| `--color-brass` | `#d2a24c` | The agent acting: focus, primary action, permission |
| `--color-patina` | `#6fa292` | History and reversibility: commits, branches, running |
| `--color-rust` | `#cb6952` | Stop, destructive, and the ungated permission mode |

Every filled accent button pairs with `text-ground`; all three accents clear 4.5:1
against the ground for their text roles.

Type is Archivo (variable, weight **and width** axes) plus IBM Plex Mono, bundled
via `@fontsource` because the renderer CSP is `default-src 'self'` and a hosted
font service is blocked. The width axis supplies the condensed `eyebrow` voice, so
the whole system is two families.

## Layout

```
┌────────────────────────────────────────────────────────────────┐
│ ●●●   ◈ anyapp │ Magic 8 Ball ● :5173 │ Ask to edit ▾  ▶ Run   │  h-11, drag
├════════════════════════════════════════════════════════════════┤  ← mode hairline
│ APPS │ MAGIC 8 BALL │                                          │
│ SKILLS│  ⎇ main     │                                          │
│      │  CHATS  +New │              Chat                        │
│      │   New chat   │                                          │
│      │              │                                          │
│      │  PANELS      ├──────────────────────────────────────────┤
│ HELP │  ⎇ History ● │          Terminal (bottom dock)          │
│ SET… │  >_ Terminal●│                                          │
│      │  ▢ Preview ○ │                                          │
└──────┴──────────────┴──────────────────────────────────────────┘
  64px      208px       (column present only when an app is open)
```

- **Nav rail (64px)** — Apps and Skills at the top, Help then Settings pinned to
  the bottom. Icon plus a 9px uppercase label, because a tooltip-only rail is what
  made the old one unreadable. Nothing is ever disabled.
- **App context column (208px)** — headed by the open app's own name, with its
  branch beneath. Holds the app's chats (the old separate `ChatSessionList` column
  folds in here) and a `PANELS` group.
- **Destinations vs toggles** — destinations get a brass leading-edge bar and
  `aria-current`; panel toggles get a trailing ring that fills brass and
  `aria-pressed`. Two behaviours, two shapes.
- **Shell header (44px)** — the window's only draggable chrome. Logo, app name,
  status pill, permission mode, run controls.

### Signature: the permission hairline

The header's bottom hairline is coloured by the agent's permission mode, so the
top of the window always states how much rope the agent has, from any view:

| Mode | Label | Hairline |
|---|---|---|
| `plan` | Explore | 2px patina |
| `default` | Ask to edit | 2px brass |
| `acceptEdits` | Auto edit | 2px brass |
| `bypassPermissions` | Auto — all | 3px rust |

`PERMISSION_MODES` in `components/PermissionModeControl.tsx` is the single source
of truth for mode wording and colour; the header control, the hairline, the chat
empty state, and the Help page all render from it. Help used to restate the mode
names by hand, which is exactly how they drifted out of step.

## The Logo

A rounded-square aperture in brass with a second, offset square in patina breaking
through its lower-right corner — an app that contains and reshapes apps. Geometry
was chosen by rendering four candidate proportions at 20/28/48/120px and picking
the one that stayed legible at the smallest size.

`components/Logo.tsx` draws the bare mark for the header. `dockIconSvg()` in
`packages/shared/src/branding/logo.ts` composes the same geometry onto a macOS app
tile, rasterized at startup with `sharp` — a dependency the main process already
had — so no `resources/` directory or asset pipeline was needed.

## Out of Scope

- `AppConfig.theme` is persisted but never applied; the app stays dark-only. The
  tokens are structured so a light theme is later a `:root[data-theme="light"]`
  override rather than a rewrite.
- No packaging config. `dockIconSvg()` covers the dock under `bun run dev`; an
  `electron-builder` icon set is a separate job.
