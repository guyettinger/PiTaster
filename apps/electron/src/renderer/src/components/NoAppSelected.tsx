/**
 * Props for the NoAppSelected component.
 */
interface NoAppSelectedProps {
  /** Callback when "Go to Apps" is clicked. */
  onGoToApps: () => void
}

/**
 * Empty state component shown when no app is selected.
 */
export function NoAppSelected({ onGoToApps }: NoAppSelectedProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mb-3 text-4xl">📱</div>
        <h3 className="mb-1 font-medium">No app selected</h3>
        <p className="mb-4 text-sm text-neutral-500">
          Select or create an app to start chatting
        </p>
        <button
          onClick={onGoToApps}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Go to Apps
        </button>
      </div>
    </div>
  )
}
