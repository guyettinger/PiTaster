# Session 17 Notes: Shell Design Pass

**Date**: 2026-08-29
**Status**: ✅ Complete

## What Was Built

The app shell was rebuilt around one rule — **the rail holds what exists without
an app, a second column holds what belongs to the open app** — and anyapp got a
visual identity: a token system, two bundled typefaces, one icon set, a logo, and
a macOS dock icon.

Before this, a 56px rail of nine identical emoji buttons drove three unrelated
behaviours (exclusive destinations, a right dock, a bottom dock) with labels only
in `title=` tooltips. Skills and Sources were disabled without an open app despite
being workspace-global data. `titleBarStyle: 'hiddenInset'` was set with no
`-webkit-app-region` anywhere in the repo, so the window could not be dragged and
the traffic lights rendered on top of the first nav button.

### Files Created

1. **`apps/electron/src/renderer/src/components/shell/`** — `AppShellHeader.tsx`
   (the draggable header, the mode hairline, and the app's identity),
   `NavRail.tsx`, `AppContextColumn.tsx`, `NavItem.tsx`, `PanelToggle.tsx`, and
   `BottomPanelContainer.tsx` (extracted from `App.tsx`).
2. **`apps/electron/src/renderer/src/components/icons/index.tsx`** (28 glyphs) —
   one hand-drawn 24×24 stroke set on a shared `Icon` frame, replacing the mix of
   literal emoji and ad-hoc heroicons paths. No icon dependency was added.
3. **`apps/electron/src/renderer/src/components/PermissionModeControl.tsx`** —
   `PERMISSION_MODES` plus the control. The single source of truth for how a mode
   is named and coloured.
4. **`apps/electron/src/renderer/src/components/Logo.tsx`** — the mark as JSX.
5. **`apps/electron/src/renderer/src/types/navigation.ts`** — `MainPanel`,
   `RightPanel`, `BottomPanel`, with the destination/dock distinction documented.
6. **`packages/shared/src/branding/logo.ts`** — `dockIconSvg()`, the same geometry
   composed onto a macOS app tile.
7. **`docs/plans/SESSION-17-SHELL-DESIGN.md`** — the plan, including the palette.

### Changed

- **`globals.css`** — was one line (`@import "tailwindcss"`). Now carries the
  `@theme` token block, the `drag` / `no-drag` / `eyebrow` utilities, a base layer
  (type, scrollbars, selection, a global brass `:focus-visible` ring), and a
  reduced-motion block.
- **`App.tsx`** — 456 → 268 lines. `MainPanel` gained `skills` and lost the
  Skills/Sources right panels. A panel toggle now also switches to the workspace,
  so a control always does what its label says.
- **`Settings.tsx`** — rewritten with a General / Sources / About tab strip.
  `SourcesPanel` mounts directly in the Sources tab; the planned
  `settings/SourcesSettings.tsx` wrapper turned out to add nothing and was dropped.
- **`SkillsPanel.tsx`** — promoted from a 288px right rail to a full-width
  destination, ungated from `activeApp`.
- **`SourcesPanel.tsx` / `VersionControl.tsx` / `ChatSessionList.tsx`** —
  de-chromed. Each used to hardcode `w-72 border-l bg-neutral-900` *inside* a
  parent that already supplied `w-80 border-l`; the parent now owns the frame.
- **`Chat.tsx`** — lost its own header row (three headers used to stack). The
  permission select moved to the shell header.
- **`Help.tsx`** — its permission-mode cards now render from `PERMISSION_MODES`,
  and its "Design System" section, which documented a stock Tailwind palette and a
  shadcn/ui component library that this repo has never contained, was rewritten to
  describe the real tokens.
- **`main/index.ts`** — `app.setName`, `trafficLightPosition`, `backgroundColor`,
  and a non-blocking `setDockIcon()`.
- **`index.html`** — CSP gained `font-src 'self'` for the bundled faces, paired with
  an `assetsInlineLimit` function in `electron.vite.config.ts` that refuses to inline
  a font. The first draft allowed `data:` too; checking the built CSS showed zero
  `data:` URIs (the smallest emitted face is 5.6 KB, above Vite's 4 KB inline
  threshold), so the allowance was unnecessary. Pinning the build behaviour rather
  than relying on it means the policy stays correct if a future subset drops under
  that threshold.
- **`AppHeader.tsx`** — deleted. `AppShellHeader` renders the existing
  `AppControls.tsx`, which nothing had ever mounted, instead of reimplementing it.

## What the Screenshots Caught

Four defects only showed up in the running app:

1. **The mark was a blob at 19px.** Rendering four candidate proportions at
   20/28/48/120px through `sharp` settled it: the aperture needed to be larger and
   the inner square smaller than first drawn.
2. **The 1px hairline was invisible**, which defeated the whole signature. It is
   2px now, 3px for `bypassPermissions`.
3. **Panel content was centred under left-aligned page headers**, so headings and
   content started at different x. Everything is left-aligned to the same gutter.
4. **At the 800×600 minimum window size with both docks open, the chat column
   collapsed to ~230px** and the composer was clipped. The right dock is now
   `w-72 max-w-[38%]`.

Two colour decisions also came out of seeing it run. The token migration had made
every *completed* tool call a patina-washed panel — a wall of green in any real
transcript — so tint is now reserved for `pending`/`running` (brass) and
`error`/`denied` (rust), and complete is neutral. And user messages had become
solid brass slabs, which both shouted and stole the accent's meaning; they are a
bordered raised surface now.

## Verification

- `bun run typecheck:all` clean.
- `bun run build` clean; all 23 faces emit as same-origin files with zero `data:`
  URIs in the CSS, and both families were confirmed rendering in the running app
  under `font-src 'self'`.
- Walked the app: rail destinations, the context column appearing with the open
  app and titled after it, session switching, all three panel toggles and their
  ring indicators, a toggle fired from Settings landing in the workspace, and
  Skills and Sources reachable with no app open.
- Cycled all four permission modes and confirmed the hairline changes colour and
  weight, and that the header wording matches the Help page.
- Confirmed window dragging by the header, with controls not dragging it, and the
  traffic lights no longer overlapping the rail.
- Rendered the dock icon at 32/64/128/256px to confirm it survives the small sizes.

## Security Review

The `electron-security-reviewer` subagent reviewed the main-process and CSP changes
and found no vulnerabilities: `dockIconSvg()` builds its SVG from numeric literals
only, so no untrusted input reaches sharp's SVG loader; the dock-icon path is fully
caught and fire-and-forget, so it cannot block or crash startup; and
contextIsolation / nodeIntegration / sandbox are untouched.

It flagged one pre-existing issue worth recording: `apps/electron/package.json`
declares `sharp@^0.33.0` alongside `@img/sharp-darwin-arm64@^0.34.5`, but sharp
0.33.5 wants the 0.33.5 binary. Both are installed — sharp resolves its own 0.33.5
(libvips 8.15.3) and works, while the explicit `^0.34.5` declaration pulls a second,
unused native binary. Not introduced by this session and not changed here, since
sharp is also on the screenshot path, but the declaration is misleading and should
be reconciled.

## Follow-ups

- `AppConfig.theme` is still inert. The tokens are shaped for a
  `:root[data-theme="light"]` override when a light theme is wanted.
- `TerminalPanel`'s ANSI colour map still uses stock Tailwind colours
  (`text-purple-500`, `text-white`); that is a terminal palette, not chrome.
- The bottom dock's 300px default is over half the height of a minimum-size
  window. It is drag-resizable, so this is a nicety rather than a defect.
