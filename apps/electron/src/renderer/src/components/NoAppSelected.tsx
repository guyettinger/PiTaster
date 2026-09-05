import { AppsIcon } from './icons'

/**
 * Props for the NoAppSelected component.
 */
interface NoAppSelectedProps {
  /** Open the app library. */
  onGoToApps: () => void
}

/**
 * Shown in the workspace when no app is open.
 */
export function NoAppSelected({ onGoToApps }: NoAppSelectedProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-xs flex-col items-center text-center">
        <span className="text-ash">
          <AppsIcon size={28} />
        </span>
        <h2 className="mt-3 text-[15px] font-semibold text-bone">No app open</h2>
        <p className="mt-1 text-[13px] text-ash">
          Open an app to start working with the agent.
        </p>
        <button
          onClick={onGoToApps}
          className="mt-4 rounded-lg bg-keylime px-4 py-2 text-[13px] font-medium text-ground transition-opacity hover:opacity-90"
        >
          Browse apps
        </button>
      </div>
    </div>
  )
}
