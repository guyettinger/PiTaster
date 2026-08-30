import { useState, useEffect, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * Props for the BottomPanelContainer component.
 */
interface BottomPanelContainerProps {
  /** Current height of the panel in pixels. */
  height: number
  /** Callback when height changes during a drag. */
  onHeightChange: (height: number) => void
  /** Panel content. */
  children: ReactNode
}

/** Height bounds for the docked bottom panel, in pixels. */
const MIN_HEIGHT = 150
const MAX_HEIGHT = 600

/**
 * Resizable container for the terminal and preview panels.
 */
export function BottomPanelContainer({
  height,
  onHeightChange,
  children
}: BottomPanelContainerProps) {
  const [isDragging, setIsDragging] = useState(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true)
      startY.current = e.clientY
      startHeight.current = height
    },
    [height]
  )

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startY.current - e.clientY
      const next = Math.min(Math.max(startHeight.current + delta, MIN_HEIGHT), MAX_HEIGHT)
      onHeightChange(next)
    }

    const handleMouseUp = () => setIsDragging(false)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, onHeightChange])

  return (
    <div className="flex shrink-0 flex-col border-t border-line" style={{ height }}>
      <div
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize panel"
        className={`group flex h-1.5 shrink-0 cursor-ns-resize items-center justify-center ${
          isDragging ? 'bg-brass/40' : 'hover:bg-brass/20'
        }`}
      >
        <div
          className={`h-0.5 w-10 rounded-full transition-colors ${
            isDragging ? 'bg-brass' : 'bg-line group-hover:bg-brass'
          }`}
        />
      </div>

      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
