import { NavItem } from './NavItem'
import { AppsIcon, LayoutIcon, SkillsIcon, HelpIcon, SettingsIcon } from '../icons'
import type { Destination } from '../../types/navigation'

/**
 * Props for the NavRail component.
 */
interface NavRailProps {
  /** The destination currently shown. */
  destination: Destination
  /** Go to a different destination. */
  onNavigate: (destination: Destination) => void
}

/**
 * The global nav rail.
 *
 * Holds only destinations that exist independently of any app — the app
 * library, the workspace's skills, help, and settings. Nothing here is ever
 * disabled: skills and MCP sources are workspace-global data under `~/.anyapp`,
 * so gating them on a focused app was always wrong.
 *
 * Workspace is the exception that proves the rule: it needs an app to show
 * anything, but it is not disabled either — with none focused it shows the empty
 * state, the same as picking it always did. It replaced a Code item, because
 * code is now a panel inside the workspace rather than a place you go.
 */
export function NavRail({ destination, onNavigate }: NavRailProps) {
  return (
    // w-20 rather than w-16: the eyebrow renders "Workspace" at 71px, and a
    // 64px rail clipped it. "Settings" at 57px had already been spilling into
    // the rail's padding, so this is the width the labels always wanted.
    <nav
      aria-label="Workspace"
      className="flex w-20 shrink-0 flex-col border-r border-line bg-panel p-2"
    >
      <div className="flex flex-col gap-0.5">
        <NavItem
          icon={<AppsIcon />}
          label="Apps"
          active={destination === 'apps'}
          onClick={() => onNavigate('apps')}
        />
        <NavItem
          icon={<LayoutIcon />}
          label="Workspace"
          active={destination === 'workspace'}
          onClick={() => onNavigate('workspace')}
        />
        <NavItem
          icon={<SkillsIcon />}
          label="Skills"
          active={destination === 'skills'}
          onClick={() => onNavigate('skills')}
        />
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-0.5">
        <NavItem
          icon={<HelpIcon />}
          label="Help"
          active={destination === 'help'}
          onClick={() => onNavigate('help')}
        />
        <NavItem
          icon={<SettingsIcon />}
          label="Settings"
          active={destination === 'settings'}
          onClick={() => onNavigate('settings')}
        />
      </div>
    </nav>
  )
}
