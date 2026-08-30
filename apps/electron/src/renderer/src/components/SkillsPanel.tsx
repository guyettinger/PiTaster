import { useState, useEffect, useCallback } from 'react'
import { SkillsIcon, SearchIcon, RefreshIcon, ChevronDownIcon } from './icons'

/**
 * Skill definition.
 */
interface Skill {
  name: string
  description: string
  content: string
  filepath: string
}

/**
 * Props for the SkillsPanel component.
 */
interface SkillsPanelProps {
  /** Callback when a skill is picked for insertion into the chat composer. */
  onSkillSelect: (skill: Skill) => void
  /** Whether an app is open, so a mention has somewhere to go. */
  canInsertMention: boolean
}

/**
 * The workspace's skills — reusable instructions the agent can be handed.
 *
 * Skills live in `~/.anyapp/skills` and belong to the workspace, not to any one
 * app, which is why this is a rail destination rather than a panel gated on an
 * open app. With an app open, picking a skill drops an `@mention` into the
 * composer; without one, the panel is still browsable.
 */
export function SkillsPanel({ onSkillSelect, canInsertMention }: SkillsPanelProps) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)

  const loadSkills = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const loaded = await window.electronAPI.getSkills()
      setSkills(loaded)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skills')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  const filteredSkills = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
  )

  const toggleExpand = useCallback((skillName: string) => {
    setExpandedSkill((prev) => (prev === skillName ? null : skillName))
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-line px-6 py-3.5">
        <div>
          <h1 className="text-[15px] font-semibold text-bone">Skills</h1>
          <p className="text-[12px] text-ash">
            Reusable instructions the agent can be handed, from{' '}
            <code className="font-mono">~/.anyapp/skills</code>
          </p>
        </div>
        <button
          onClick={loadSkills}
          className="rounded p-1.5 text-ash transition-colors hover:bg-raised hover:text-bone"
          title="Reload skills"
        >
          <RefreshIcon size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-3xl">
          <div className="relative">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ash"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter skills"
              className="w-full rounded-lg border border-line bg-raised py-2 pl-9 pr-3 text-[13px] text-bone placeholder-ash transition-colors hover:border-ash"
            />
          </div>

          {isLoading ? (
            <p className="mt-8 text-center text-[13px] text-ash">Loading skills…</p>
          ) : error ? (
            <div className="mt-6 rounded-lg border border-rust/40 bg-rust/10 p-4">
              <p className="text-[13px] text-bone">{error}</p>
              <button
                onClick={loadSkills}
                className="mt-2 text-[13px] text-brass hover:underline"
              >
                Try again
              </button>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="mt-10 flex flex-col items-center text-center">
              <span className="text-ash">
                <SkillsIcon size={26} />
              </span>
              {skills.length === 0 ? (
                <>
                  <p className="mt-3 text-[13px] text-bone">No skills yet</p>
                  <p className="mt-1 text-[12px] text-ash">
                    Drop a folder with a <code className="font-mono">SKILL.md</code> into{' '}
                    <code className="font-mono">~/.anyapp/skills</code> and reload.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-[13px] text-ash">
                  No skill matches &ldquo;{search}&rdquo;.
                </p>
              )}
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {filteredSkills.map((skill) => (
                <li
                  key={skill.name}
                  className="overflow-hidden rounded-lg border border-line bg-panel"
                >
                  <div className="flex items-start gap-2 p-3">
                    <button
                      onClick={() => onSkillSelect(skill)}
                      disabled={!canInsertMention}
                      title={
                        canInsertMention
                          ? `Insert @${skill.name} into the chat`
                          : 'Open an app to use this skill in a chat'
                      }
                      className="min-w-0 flex-1 text-left disabled:cursor-default"
                    >
                      <span className="font-mono text-[13px] font-medium text-brass">
                        @{skill.name}
                      </span>
                      <p className="mt-0.5 text-[12.5px] text-ash">
                        {skill.description || 'No description'}
                      </p>
                    </button>
                    <button
                      onClick={() => toggleExpand(skill.name)}
                      aria-expanded={expandedSkill === skill.name}
                      className="shrink-0 rounded p-1 text-ash transition-colors hover:bg-raised hover:text-bone"
                      title="Preview this skill"
                    >
                      <ChevronDownIcon
                        size={16}
                        className={`transition-transform ${
                          expandedSkill === skill.name ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </div>

                  {expandedSkill === skill.name && (
                    <div className="border-t border-line bg-ground p-3">
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ash">
                        {skill.content.slice(0, 1200)}
                        {skill.content.length > 1200 && '\n…'}
                      </pre>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {filteredSkills.length > 0 && (
            <p className="mt-4 text-center text-[11.5px] text-ash">
              {canInsertMention
                ? 'Pick a skill to add it to the chat as an @mention.'
                : 'Open an app to use a skill in a chat.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
