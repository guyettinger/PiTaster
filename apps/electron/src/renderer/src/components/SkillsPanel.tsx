import { useState, useEffect, useCallback } from 'react'

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
  /** Whether the panel is visible. */
  isVisible: boolean
  /** Callback when a skill is selected. */
  onSkillSelect: (skill: Skill) => void
}

/**
 * Skills panel component for managing reusable agent instructions.
 */
export function SkillsPanel({ isVisible, onSkillSelect }: SkillsPanelProps) {
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
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to load skills'
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isVisible) {
      loadSkills()
    }
  }, [isVisible, loadSkills])

  const filteredSkills = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
  )

  const handleSkillClick = useCallback(
    (skill: Skill) => {
      onSkillSelect(skill)
    },
    [onSkillSelect]
  )

  const toggleExpand = useCallback((skillName: string) => {
    setExpandedSkill((prev) => (prev === skillName ? null : skillName))
  }, [])

  if (!isVisible) return null

  return (
    <div className="flex w-72 flex-col border-l border-neutral-800 bg-neutral-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <h2 className="text-sm font-medium text-neutral-300">Skills</h2>
        <button
          onClick={loadSkills}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
          title="Refresh"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-neutral-800 p-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills..."
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500"
        />
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm text-neutral-500">Loading...</span>
        </div>
      ) : error ? (
        <div className="p-3">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={loadSkills}
            className="mt-2 text-sm text-blue-400 hover:underline"
          >
            Retry
          </button>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <svg
            className="mb-2 h-8 w-8 text-neutral-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          {skills.length === 0 ? (
            <>
              <p className="text-sm text-neutral-500">No skills available</p>
              <p className="mt-1 text-xs text-neutral-600">
                Add skills in ~/.anyapp/skills/
              </p>
            </>
          ) : (
            <p className="text-sm text-neutral-500">No matching skills</p>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {filteredSkills.map((skill) => (
            <div
              key={skill.name}
              className="border-b border-neutral-800"
            >
              <button
                onClick={() => handleSkillClick(skill)}
                className="w-full p-3 text-left hover:bg-neutral-800/50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-blue-400">
                    @{skill.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleExpand(skill.name)
                    }}
                    className="rounded p-1 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300"
                  >
                    <svg
                      className={`h-4 w-4 transition-transform ${
                        expandedSkill === skill.name ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                </div>
                <p className="mt-0.5 text-xs text-neutral-500 line-clamp-2">
                  {skill.description || 'No description'}
                </p>
              </button>

              {/* Expanded content preview */}
              {expandedSkill === skill.name && (
                <div className="border-t border-neutral-800 bg-neutral-950 p-3">
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-neutral-400">
                    {skill.content.slice(0, 500)}
                    {skill.content.length > 500 && '...'}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer with hint */}
      <div className="border-t border-neutral-800 p-2">
        <p className="text-center text-xs text-neutral-600">
          Click to insert @mention
        </p>
      </div>
    </div>
  )
}
