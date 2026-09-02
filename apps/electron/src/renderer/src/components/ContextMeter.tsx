import { useCallback, useEffect, useRef, useState } from 'react'
import { ContextBreakdown, formatTokens } from './ContextBreakdown'
import type { ContextReport } from '../types/electron'

/**
 * How long the card stays open after the pointer leaves.
 *
 * The card carries links and a button, so the pointer has to be able to travel from the
 * meter into it across the gap between them. A card that closes the instant the pointer
 * leaves its trigger is a card whose actions cannot be reached.
 */
const CLOSE_DELAY_MS = 160

/** Fraction of the window past which the meter reads as a warning rather than a fact. */
const CROWDED = 0.85

/**
 * Props for the {@link ContextMeter} component.
 */
export interface ContextMeterProps {
  /** What the window holds, or null before the first read settles. */
  report: ContextReport | null
  /** Open the Skills page. */
  onOpenSkills: () => void
  /** Summarize the conversation now. */
  onCompact: () => void
  /** Whether a manual compaction is running. */
  isCompacting: boolean
  /** The last compaction failure, or null. */
  error: string | null
}

/**
 * How full the context window is, and what is filling it.
 *
 * This used to be hidden more often than it was shown. It read a number that existed
 * only after a completed turn, and the agent host that answered for it was torn down on
 * an app switch, a session switch, and every skills, sources or config save — so the
 * meter blinked out several times a minute during ordinary use, and was absent entirely
 * until the first turn of a session finished with the chat panel open.
 *
 * It now renders unconditionally, because main can always answer: the fixed half of a
 * request is a pure function of the app and its configuration. The only thing that
 * varies is how much of the number is measured, which the card says out loud.
 */
export function ContextMeter({
  report,
  onOpenSkills,
  onCompact,
  isCompacting,
  error
}: ContextMeterProps) {
  const [isHovering, setIsHovering] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapper = useRef<HTMLDivElement>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const open = useCallback(() => {
    cancelClose()
    setIsHovering(true)
  }, [cancelClose])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setIsHovering(false), CLOSE_DELAY_MS)
  }, [cancelClose])

  useEffect(() => cancelClose, [cancelClose])

  // A pinned card outlives the pointer, so it needs the two ways out that every other
  // pinned surface has: Escape, and a click anywhere else.
  useEffect(() => {
    if (!isPinned) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsPinned(false)
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (!wrapper.current?.contains(event.target as Node)) setIsPinned(false)
    }

    window.addEventListener('keydown', onKeyDown)
    // Capture, so a click that a child stops from bubbling still unpins.
    window.addEventListener('pointerdown', onPointerDown, true)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [isPinned])

  const total = report ? (report.measured ?? report.estimated) : 0
  const fraction = report ? Math.min(1, total / Math.max(1, report.window)) : 0
  const isOpen = report !== null && (isPinned || isHovering)

  // `stale` and `floor` are honest but not current, so the meter recedes rather than
  // asserting. Crowding is the one thing worth shouting about.
  const dim = report === null || report.state === 'stale' || report.state === 'floor'
  const fill = fraction > CROWDED ? 'bg-rust' : dim ? 'bg-ash' : 'bg-brass'

  return (
    <div ref={wrapper} className="relative" onMouseEnter={open} onMouseLeave={scheduleClose}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label={
          report
            ? `Context: ${total.toLocaleString()} of ${report.window.toLocaleString()} tokens`
            : 'Context usage'
        }
        onClick={() => setIsPinned((pinned) => !pinned)}
        onFocus={open}
        onBlur={scheduleClose}
        className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] text-ash transition-colors hover:bg-raised hover:text-bone"
      >
        <span className="h-1 w-16 overflow-hidden rounded-full bg-line">
          <span
            className={`block h-full rounded-full ${fill}`}
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </span>
        <span className={`tabular-nums ${dim ? 'opacity-60' : ''}`}>
          {report
            ? `${report.state === 'estimated' ? '~' : ''}${formatTokens(total)} / ${formatTokens(report.window)}`
            : '— / —'}
        </span>
      </button>

      {isOpen && report && (
        <div className="absolute bottom-full right-0 z-20 mb-2">
          <ContextBreakdown
            report={report}
            onOpenSkills={() => {
              setIsPinned(false)
              onOpenSkills()
            }}
            onCompact={onCompact}
            isCompacting={isCompacting}
            error={error}
          />
        </div>
      )}
    </div>
  )
}
