import type { AppTemplate } from '@keylimepi/core'

/**
 * The templates a new sub-app can be created from.
 *
 * The glyphs are content, not chrome — `.claude/rules/react.md` reserves emoji
 * for exactly this, and everything structural is drawn from `components/icons`.
 *
 * Only the create form draws them now. They are how you *choose* a template,
 * which is the one moment the template is the thing being named; after that an
 * app is identified by `AppIcon`'s name monogram in both the nav rail and the
 * Apps list. The card in that list used to draw the glyph and nothing else,
 * which made a library of three React apps three identical icons — a glyph
 * shared by every app from one template cannot distinguish the apps it is drawn
 * beside, and that is the whole job of an icon in a list.
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
