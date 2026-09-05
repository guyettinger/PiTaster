import { useCallback, useMemo, useState } from 'react'
import { RefreshIcon, SearchIcon } from '../icons'
import { manifestCost, useSkills } from '../../hooks/useSkills'
import { filterSkills } from './filterSkills'
import { SkillEditor } from './SkillEditor'
import { SkillRow } from './SkillRow'
import { SkillSection } from './SkillSection'
import type { Skill, SkillDraft } from '@pitaster/core'

/**
 * Props for the AppSkillsPanel component.
 */
interface AppSkillsPanelProps {
  /** The app this panel belongs to. */
  appId: string
  /** Its name, for the header and the empty states. */
  appName: string
}

/**
 * One app's skills: the ones it owns, and the workspace ones it has turned on.
 *
 * This is a dock panel rather than a nav-rail destination, and the move is the
 * point. Whether a skill is on is `SubApp.disabledSkills` — per app — so as a
 * global page every toggle here was disabled until an app happened to be open.
 * Inside the app, there is always an app.
 *
 * The split shown is the one the agent actually reads. **This app's** skills
 * live in its own `skills/` directory: inside what the agent can write, committed
 * with the app, and they win a name collision. **Workspace** skills live in
 * `~/.pitaster/skills` and are offered to every app — togglable here because the
 * toggle is this app's, but authored in Settings, because the body is not.
 *
 * The header states what this app pays. Every enabled skill's description rides
 * in every request whether or not the model reaches for it, so the count is the
 * honest answer to "what am I paying for this" — and it is what makes turning
 * one off feel like a decision rather than a preference.
 */
export function AppSkillsPanel({ appId, appName }: AppSkillsPanelProps) {
  const { library, isLoading, error, warning, reload, save, remove, setEnabled } =
    useSkills(appId)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [editing, setEditing] = useState<Skill | null>(null)

  const appSkills = useMemo(() => filterSkills(library.app, search), [library.app, search])
  const workspaceSkills = useMemo(
    () => filterSkills(library.workspace, search),
    [library.workspace, search]
  )

  const all = useMemo(
    () => [...library.app, ...library.workspace],
    [library.app, library.workspace]
  )
  const total = all.length
  const active = all.filter(
    (skill) => skill.enabled && !skill.shadowed && skill.description.length > 0
  ).length
  const cost = manifestCost(all)

  const handleSave = useCallback(
    async (draft: SkillDraft) => {
      // Only this app's library is writable from here, so the scope is not a
      // choice the user can get wrong.
      await save('app', draft)
      setIsAdding(false)
      setEditing(null)
      setExpanded(`app:${draft.name}`)
    },
    [save]
  )

  const expandKey = useCallback((scope: string, name: string) => `${scope}:${name}`, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-line px-3 py-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-bone">Skills · {appName}</p>
          <p className="text-[12px] text-ash">
            {total === 0
              ? 'Instructions the agent loads when a task matches one.'
              : `${active} of ${total} active · ${cost} tokens in every request`}
          </p>
        </div>
        <button
          onClick={() => void reload()}
          aria-label="Reload skills"
          title="Re-read both skill folders"
          className="shrink-0 rounded p-1.5 text-ash transition-colors hover:bg-raised hover:text-bone"
        >
          <RefreshIcon size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="relative">
          <SearchIcon
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ash"
          />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter skills"
            className="w-full rounded-lg border border-line bg-raised py-2 pl-9 pr-3 text-[13px] text-bone placeholder-ash transition-colors hover:border-ash"
          />
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rust/40 bg-rust/10 p-4">
            <p className="text-[13px] text-bone">{error}</p>
            <button
              onClick={() => void reload()}
              className="mt-2 text-[13px] text-keylime hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {warning && (
          <div className="mt-4 rounded-lg border border-keylime/40 bg-keylime/10 p-4">
            <p className="text-[13px] text-bone">{warning}</p>
          </div>
        )}

        {isLoading ? (
          <p className="mt-8 text-center text-[13px] text-ash">Reading skills…</p>
        ) : (
          <div className="mt-6 space-y-8">
            <SkillSection
              label={`This app · ${appName}`}
              count={library.app.length}
              versioned
              onAdd={() => {
                setEditing(null)
                setIsAdding(true)
              }}
              addTitle={`Write a skill that lives with ${appName}`}
            >
              {isAdding ? (
                <ul className="space-y-2">
                  <SkillEditor
                    skill={null}
                    scopeLabel="Committed with this app, in its skills/ folder"
                    onSave={handleSave}
                    onCancel={() => setIsAdding(false)}
                  />
                </ul>
              ) : appSkills.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
                  <p className="text-[13px] text-bone">
                    {library.app.length === 0
                      ? `${appName} has no skills of its own yet.`
                      : `No skill here matches “${search}”.`}
                  </p>
                  {library.app.length === 0 && (
                    <p className="mt-1 text-[12px] text-ash">
                      A skill written here is committed with the app and beats a workspace
                      skill of the same name. The agent can write one too.
                    </p>
                  )}
                </div>
              ) : (
                <ul className="space-y-2">
                  {appSkills.map((skill) =>
                    editing?.name === skill.name ? (
                      <SkillEditor
                        key={skill.name}
                        skill={skill}
                        scopeLabel={skill.filepath}
                        onSave={handleSave}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <SkillRow
                        key={skill.name}
                        skill={skill}
                        expanded={expanded === expandKey('app', skill.name)}
                        onToggleExpand={() =>
                          setExpanded((prev) =>
                            prev === expandKey('app', skill.name)
                              ? null
                              : expandKey('app', skill.name)
                          )
                        }
                        onSetEnabled={(enabled) => void setEnabled(skill.name, enabled)}
                        onEdit={() => {
                          setIsAdding(false)
                          setEditing(skill)
                        }}
                        onDelete={() => void remove('app', skill.name)}
                        canToggle
                      />
                    )
                  )}
                </ul>
              )}
            </SkillSection>

            <SkillSection label="From the workspace" count={library.workspace.length}>
              {workspaceSkills.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
                  <p className="text-[13px] text-bone">
                    {library.workspace.length === 0
                      ? 'No workspace skills yet.'
                      : `No skill here matches “${search}”.`}
                  </p>
                  <p className="mt-1 text-[12px] text-ash">
                    Workspace skills are offered to every app. Write them in Settings →
                    Skills.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {workspaceSkills.map((skill) => (
                    <SkillRow
                      key={skill.name}
                      skill={skill}
                      expanded={expanded === expandKey('workspace', skill.name)}
                      onToggleExpand={() =>
                        setExpanded((prev) =>
                          prev === expandKey('workspace', skill.name)
                            ? null
                            : expandKey('workspace', skill.name)
                        )
                      }
                      onSetEnabled={(enabled) => void setEnabled(skill.name, enabled)}
                      editNote="Edit in Settings → Skills"
                      canToggle
                    />
                  ))}
                </ul>
              )}
            </SkillSection>
          </div>
        )}
      </div>
    </div>
  )
}
