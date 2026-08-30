import { NavItem } from './NavItem'
import { AppsIcon, SkillsIcon, HelpIcon, SettingsIcon } from '../icons'
import type { MainPanel } from '../../types/navigation'

/**
 * Props for the NavRail component.
 */
interface NavRailProps {
  /** The main panel currently shown. */
  panel: MainPanel
  /** Navigate to a different main panel. */
  onNavigate: (panel: MainPanel) => void
}

/**
 * The global nav rail.
 *
 * Holds only destinations that exist independently of any app — the app
 * library, the workspace's skills, help, and settings. Nothing here is ever
 * disabled: skills and MCP sources are workspace-global data under `~/.anyapp`,
 * so gating them on a focused app was always wrong.
 *
 * Anything scoped to a single app lives in `AppContextColumn` instead.
 */
export function NavRail({ panel, onNavigate }: NavRailProps) {
  return (
    <nav
      aria-label="Workspace"
      className="flex w-16 shrink-0 flex-col border-r border-line bg-panel p-2"
    >
      <div className="flex flex-col gap-0.5">
        <NavItem
          icon={<AppsIcon />}
          label="Apps"
          active={panel === 'apps'}
          onClick={() => onNavigate('apps')}
        />
        <NavItem
          icon={<SkillsIcon />}
          label="Skills"
          active={panel === 'skills'}
          onClick={() => onNavigate('skills')}
        />
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-0.5">
        <NavItem
          icon={<HelpIcon />}
          label="Help"
          active={panel === 'help'}
          onClick={() => onNavigate('help')}
        />
        <NavItem
          icon={<SettingsIcon />}
          label="Settings"
          active={panel === 'settings'}
          onClick={() => onNavigate('settings')}
        />
      </div>
    </nav>
  )
}
