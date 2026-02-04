import type { SubApp, AppTemplate } from '@anyapp/core'

/**
 * Props for the AppHeader component.
 */
interface AppHeaderProps {
  /** The currently active app. */
  app: SubApp | null
  /** Callback when back button is clicked. */
  onBack: () => void
}

const TEMPLATE_LABELS: Record<AppTemplate, string> = {
  'react-vite': 'React + Vite',
  'node-cli': 'Node CLI',
  'node-server': 'Node Server',
  'static-site': 'Static Site',
  'blank': 'Blank Project'
}

/**
 * Header component showing active app context.
 */
export function AppHeader({ app, onBack }: AppHeaderProps) {
  if (!app) return null

  return (
    <div className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-900/50 px-4 py-2">
      <button
        onClick={onBack}
        className="rounded p-1.5 transition-colors hover:bg-neutral-800"
        title="Back to app list"
      >
        ←
      </button>
      
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-medium">{app.name}</h2>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span>{TEMPLATE_LABELS[app.template]}</span>
          {app.currentBranch && (
            <>
              <span>•</span>
              <span className="flex items-center gap-1">
                🌿 {app.currentBranch}
              </span>
            </>
          )}
          {app.hasChanges && (
            <>
              <span>•</span>
              <span className="text-yellow-500">Uncommitted changes</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
