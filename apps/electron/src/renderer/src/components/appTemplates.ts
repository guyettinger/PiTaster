import type { AppTemplate } from '@keylimepi/core'

/**
 * The templates a new sub-app can be created from.
 *
 * The glyphs are content, not chrome — `.claude/rules/react.md` reserves emoji
 * for exactly this, and everything structural is drawn from `components/icons`.
 * They live here rather than inline in `AppListing` because the create form and
 * the app cards both read them, and two copies would drift. The nav rail draws a
 * *name* monogram rather than a glyph: every app from one template shares its
 * glyph, so a rail of three React apps would be three identical tiles.
 */
export const TEMPLATES: { id: AppTemplate; name: string; icon: string }[] = [
  { id: 'react-vite', name: 'React + Vite', icon: '⚛️' },
  { id: 'node-cli', name: 'Node CLI', icon: '💻' },
  { id: 'node-server', name: 'Node Server', icon: '🌐' },
  { id: 'static-site', name: 'Static Site', icon: '📄' },
  { id: 'blank', name: 'Blank', icon: '📁' }
]

/** Templates that can be started as a dev server. */
export const RUNNABLE_TEMPLATES: AppTemplate[] = [
  'react-vite',
  'node-server',
  'node-cli',
  'static-site'
]
