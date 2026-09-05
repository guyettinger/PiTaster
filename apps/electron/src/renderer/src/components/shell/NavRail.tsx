import { NavItem } from './NavItem'
import { AppTile } from './AppTile'
import { AppsIcon, HelpIcon, SettingsIcon } from '../icons'
import type { Destination } from '../../types/navigation'
import type { SubApp } from '@pitaster/core'

/**
 * Props for the NavRail component.
 */
interface NavRailProps {
  /** The destination covering the workspace, or null when a workspace is shown. */
  destination: Destination | null
  /** Go to a destination. */
  onNavigate: (destination: Destination) => void
  /** The apps with a tile, in rail order. */
  openApps: SubApp[]
  /** The app whose workspace is shown, or null. */
  focusedAppId: string | null
  /** Ids of apps whose agent is mid-turn. */
  busyAppIds: readonly string[]
  /** Show an open app's workspace. */
  onFocusApp: (appId: string) => void
  /** Close an open app's tile. */
  onCloseApp: (appId: string) => void
}

/**
 * The global nav rail.
 *
 * Two kinds of thing, deliberately drawn differently. The fixed destinations —
 * the app library, help, settings — exist independently of any app and replace
 * the main view. Between them sit the open apps, one tile each, and focusing one
 * does not navigate anywhere: it uncovers the workspace that was there all along.
 *
 * That is why "Workspace" is gone as a destination. It was a label for a place
 * that only ever showed one app, and at 71px it was also what forced the rail to
 * `w-20` — a 64px rail clipped it. With the app itself as the destination the
 * remaining labels are Apps, Help and Settings, none wider than "Settings" at
 * 57px, so the rail fits the width its labels always wanted.
 *
 * Skills left for the same reason in reverse: it was a rail destination whose
 * state — `SubApp.disabledSkills` — is per app, so with no app focused every
 * toggle on it was disabled. It is a panel in the app's dock now, and the
 * workspace library it also showed is in Settings.
 */
export function NavRail({
  destination,
  onNavigate,
  openApps,
  focusedAppId,
  busyAppIds,
  onFocusApp,
  onCloseApp
}: NavRailProps) {
  return (
    <nav
      aria-label="Workspace"
      className="flex w-16 shrink-0 flex-col border-r border-line bg-panel p-2"
    >
      <div className="flex flex-col gap-0.5">
        <NavItem
          icon={<AppsIcon />}
          label="Apps"
          active={destination === 'apps'}
          onClick={() => onNavigate('apps')}
        />
      </div>

      {openApps.length > 0 && (
        <>
          <div className="my-2 border-t border-line" aria-hidden="true" />
          <div className="flex flex-col gap-0.5">
            {openApps.map((app) => (
              <AppTile
                key={app.id}
                app={app}
                focused={destination === null && app.id === focusedAppId}
                busy={busyAppIds.includes(app.id)}
                onFocus={() => onFocusApp(app.id)}
                onClose={() => onCloseApp(app.id)}
              />
            ))}
          </div>
        </>
      )}

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
