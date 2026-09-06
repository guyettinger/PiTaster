import { useEffect, useMemo, useState } from 'react'
import type { Skill } from '@keylimepi/core'

/** Most suggestions shown at once. */
const MAX_SUGGESTIONS = 6

/** Matches a mention being typed at the end of the composer. */
const TRAILING_MENTION = /(?:^|\s)@([a-z0-9-]*)$/

/**
 * The mention fragment the caret is sitting in, if any.
 * @param value - The composer's current text
 * @returns The partial skill name after `@`, or null when not in a mention
 */
export function trailingMention(value: string): string | null {
  return TRAILING_MENTION.exec(value)?.[1] ?? null
}

/**
 * Replace the mention being typed with a chosen skill name.
 * @param value - The composer's current text
 * @param name - The skill to complete to
 * @returns The composer text with the mention completed and a trailing space
 */
export function completeMention(value: string, name: string): string {
  return `${value.replace(TRAILING_MENTION, (match) => (match.startsWith(' ') ? ' ' : ''))}@${name} `
}

/**
 * Props for the SkillMentionMenu component.
 */
interface SkillMentionMenuProps {
  /** The skills the open app actually offers. */
  skills: Skill[]
  /** The partial name after `@`, or null to render nothing. */
  query: string | null
  /** The suggestion the user is on. */
  activeIndex: number
  /** Complete the mention to a skill. */
  onPick: (name: string) => void
}

/**
 * Suggestions for a skill mention being typed.
 *
 * `@name` used to be a hint and nothing more: it went into the message as text, no
 * autocomplete offered it, and nothing in the main process ever read it — so a
 * misremembered name failed silently. It is a real instruction now, which is exactly why
 * it needs completion: the model is handed the skill by name, and a name that does not
 * exist reaches nothing.
 */
export function SkillMentionMenu({
  skills,
  query,
  activeIndex,
  onPick
}: SkillMentionMenuProps) {
  const matches = useMentionMatches(skills, query)
  if (matches.length === 0) return null

  return (
    <ul
      role="listbox"
      aria-label="Skills"
      className="mb-2 overflow-hidden rounded-lg border border-line bg-panel"
    >
      {matches.map((skill, index) => (
        <li key={`${skill.scope}:${skill.name}`}>
          <button
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => {
              // Before blur, or the composer loses the caret the completion needs.
              event.preventDefault()
              onPick(skill.name)
            }}
            className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left transition-colors ${
              index === activeIndex ? 'bg-raised' : 'hover:bg-raised/60'
            }`}
          >
            <span className="shrink-0 font-mono text-[13px] text-bone">{skill.name}</span>
            <span className="truncate text-[12px] text-ash">{skill.description}</span>
            {skill.scope === 'app' && (
              <span className="eyebrow ml-auto shrink-0 text-patina">App</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * The skills matching a mention fragment.
 * @param skills - The skills the app offers
 * @param query - The partial name after `@`, or null
 * @returns Up to {@link MAX_SUGGESTIONS} matches, app skills first
 */
export function useMentionMatches(skills: Skill[], query: string | null): Skill[] {
  return useMemo(() => {
    if (query === null) return []
    const needle = query.toLowerCase()
    return skills
      .filter((skill) => skill.name.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS)
  }, [skills, query])
}

/**
 * Track which suggestion the arrow keys are on, resetting when the query changes.
 * @param query - The partial name after `@`, or null
 * @param count - How many suggestions are showing
 * @returns The active index and a setter
 */
export function useMentionCursor(
  query: string | null,
  count: number
): [number, (next: number) => void] {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex(0)
  }, [query])

  const clamped = count === 0 ? 0 : Math.min(index, count - 1)
  return [clamped, setIndex]
}
