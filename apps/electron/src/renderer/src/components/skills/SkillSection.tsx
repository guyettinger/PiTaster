import type { ReactNode } from 'react'
import { PlusIcon } from '../icons'

/**
 * Props for the SkillSection component.
 */
interface SkillSectionProps {
  /** The section's eyebrow, e.g. "This app · Pony Pony Pony". */
  label: string
  /** How many skills are in it. */
  count: number
  /** True for the app's own library, which is marked in patina. */
  versioned?: boolean
  /** Start writing a skill in this library, or undefined when that is not possible. */
  onAdd?: () => void
  /** What adding does, for the button's title. */
  addTitle?: string
  /** The rows, or an empty state. */
  children: ReactNode
}

/**
 * One skill library, headed by where its skills live.
 *
 * Add lives here rather than in the page header. Scope is then carried by the structure
 * — you add where you were looking — and the editor needs no library picker, which is
 * one control and one decision removed.
 */
export function SkillSection({
  label,
  count,
  versioned = false,
  onAdd,
  addTitle,
  children
}: SkillSectionProps) {
  return (
    <section>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${versioned ? 'bg-patina' : 'bg-line'}`}
        />
        <h2 className="eyebrow text-ash">{label}</h2>
        <span className="font-mono text-[11px] tabular-nums text-ash">{count}</span>
        <span className="h-px flex-1 bg-line" />
        {onAdd && (
          <button
            onClick={onAdd}
            title={addTitle}
            className="shrink-0 rounded p-1 text-ash transition-colors hover:bg-raised hover:text-bone"
          >
            <PlusIcon size={16} />
          </button>
        )}
      </div>

      <div className="mt-3">{children}</div>
    </section>
  )
}
