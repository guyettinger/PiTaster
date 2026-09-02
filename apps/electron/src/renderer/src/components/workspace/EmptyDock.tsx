import { LayoutIcon } from '../icons'
import { resetLayout } from './actions'
import type { IWatermarkPanelProps } from 'dockview-react'

/**
 * What the workspace shows once every panel has been closed.
 *
 * Closing the last panel used to leave a black rectangle. The way back — the
 * Panels menu — was still there in the bar above, but nothing on screen said so,
 * and a dock you can empty into a dead end is a dock people are right not to
 * rearrange. So the empty state names both routes back and carries the one that
 * always works.
 */
export function EmptyDock({ containerApi }: IWatermarkPanelProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <LayoutIcon size={28} className="text-ash" />

      <div className="space-y-1">
        <p className="text-sm text-bone">No panels open</p>
        <p className="max-w-sm text-[13px] text-ash">
          Open one from the <span className="text-bone">Panels</span> menu above, or start
          again from the default arrangement.
        </p>
      </div>

      <button
        onClick={() => resetLayout(containerApi)}
        className="rounded-md bg-brass px-4 py-2 text-[13px] font-medium text-ground transition-opacity hover:opacity-90"
      >
        Restore default layout
      </button>
    </div>
  )
}
