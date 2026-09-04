import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * How long the card stays open after the pointer leaves.
 *
 * Every card here carries links and buttons, so the pointer has to be able to travel
 * from the gauge into the card across the gap between them. A card that closes the
 * instant the pointer leaves its trigger is a card whose actions cannot be reached.
 */
const CLOSE_DELAY_MS = 160

/**
 * Props for the GaugePopover component.
 */
export interface GaugePopoverProps {
  /** What the instrument row shows: the gauge itself. */
  trigger: ReactNode
  /**
   * The card. Rendered only while open.
   *
   * A function when the card has actions: every one of them either navigates away or
   * opens a panel, and a pinned card left standing behind what it just opened is a
   * card the user has to dismiss by hand for having used it.
   */
  children: ReactNode | ((close: () => void) => ReactNode)
  /** Accessible name for the trigger. */
  label: string
  /**
   * Whether there is a card to show.
   *
   * A gauge with nothing behind it is not a button — it should not take focus, show a
   * hover state, or announce itself as expandable.
   */
  hasCard?: boolean
}

/**
 * A gauge and the card it opens.
 *
 * One mechanic, shared by every gauge in the instrument row. There used to be two: the
 * context meter's, which opens on hover, survives the pointer's journey to the card,
 * and can be pinned with a click; and the changed-files strip's, which was click-only,
 * listened on `mousedown`, and had no travel delay — so its list closed under a pointer
 * heading for one of its rows.
 *
 * A pinned card outlives the pointer, so it needs the two ways out that every other
 * pinned surface in the app has: Escape, and a click anywhere else. The outside click
 * is bound in the capture phase, so a click a child stops from bubbling still unpins.
 */
export function GaugePopover({ trigger, children, label, hasCard = true }: GaugePopoverProps) {
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

  useEffect(() => {
    if (!isPinned) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsPinned(false)
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (!wrapper.current?.contains(event.target as Node)) setIsPinned(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown, true)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [isPinned])

  // A card that has gone away while pinned — a session cleared, a report lost — must
  // not leave the pin set, or it reopens on the next thing that has something to say.
  useEffect(() => {
    if (!hasCard) setIsPinned(false)
  }, [hasCard])

  const isOpen = hasCard && (isPinned || isHovering)

  const close = useCallback(() => {
    cancelClose()
    setIsPinned(false)
    setIsHovering(false)
  }, [cancelClose])

  return (
    <div ref={wrapper} className="relative" onMouseEnter={open} onMouseLeave={scheduleClose}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label={label}
        disabled={!hasCard}
        onClick={() => setIsPinned((pinned) => !pinned)}
        onFocus={open}
        onBlur={scheduleClose}
        className="flex max-w-full items-center gap-2 rounded px-1 py-0.5 text-ash transition-colors hover:bg-raised hover:text-bone disabled:cursor-default disabled:hover:bg-transparent"
      >
        {trigger}
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 z-20 mb-2">
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}

/**
 * The shell every gauge card shares: a bordered panel that floats over the transcript.
 */
export interface GaugeCardProps {
  /** Card width class, e.g. `w-[22rem]`. */
  width?: string
  /** The card's content. */
  children: ReactNode
}

/**
 * A gauge's card.
 *
 * Separated from {@link GaugePopover} so a card can also be rendered outside a popover
 * — the panels reuse the same blocks at full height — and so the four cards cannot
 * drift apart on padding, border and shadow.
 */
export function GaugeCard({ width = 'w-[22rem]', children }: GaugeCardProps) {
  return (
    <div
      className={`${width} max-w-[90vw] cursor-default rounded-lg border border-line bg-panel py-3 text-left text-[11px] shadow-lg shadow-ground/60`}
    >
      {children}
    </div>
  )
}
