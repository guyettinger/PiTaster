import { useCallback, useMemo, useState } from 'react'
import { RefreshIcon, SearchIcon, SkillsIcon } from '../icons'
import { manifestCost, useSkills } from '../../hooks/useSkills'
import { SkillEditor } from './SkillEditor'
import { SkillRow } from './SkillRow'
import { SkillSection } from './SkillSection'
import type { Skill, SkillDraft, SkillScope } from '@pitaster/core'

/**
 * Props for the SkillsPanel component.
 */
interface SkillsPanelProps {
  /** The open app's name, or null when none is open. */
  appName: string | null
}

/** Which editor is open, if any. */
interface EditorState {
  /** The library being written to. */
  scope: SkillScope
  /** The skill being changed, or null when writing a new one. */
  skill: Skill | null
}

/**
 * Filter a library by a search string, over name and description.
 * @param skills - The library's skills
 * @param search - What the user typed
 * @returns The matching skills
 */
function filterSkills(skills: Skill[], search: string): Skill[] {
  const needle = search.trim().toLowerCase()
  if (needle.length === 0) return skills

  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(needle) ||
      skill.description.toLowerCase().includes(needle)
  )
}

/**
 * The workspace's skills, in the two libraries the agent actually reads.
 *
 * The page is split because the split is real and used to be invisible. **This app's**
 * skills live in the app's own `skills/` directory: they are inside what the agent can
 * write, they commit with the app, and they win a name collision. **Workspace** skills
 * live in `~/.pitaster/skills` and are offered to every app. Before this, only the second
 * library existed here, and the app-scoped skills the agent had been writing for itself
 * were not shown anywhere.
 *
 * The header states what the whole page costs. Every skill's description rides in every
 * request whether or not the model ever reaches for it, so the count is the honest
 * answer to "what am I paying for this" — and it is what makes turning one off feel
 * like a decision rather than a preference.
 */
export function SkillsPanel({ appName }: SkillsPanelProps) {
  const { library, isLoading, error, warning, reload, save, remove, setEnabled } = useSkills()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)

  const appSkills = useMemo(() => filterSkills(library.app, search), [library.app, search])
  const workspaceSkills = useMemo(
    () => filterSkills(library.workspace, search),
    [library.workspace, search]
  )

  const total = library.app.length + library.workspace.length
  const active = [...library.app, ...library.workspace].filter(
    (skill) => skill.enabled && !skill.shadowed && skill.description.length > 0
  ).length
  const cost = manifestCost([...library.app, ...library.workspace])

  const handleSave = useCallback(
    async (draft: SkillDraft) => {
      if (!editor) return
      await save(editor.scope, draft)
      setEditor(null)
      setExpanded(draft.name)
    },
    [editor, save]
  )

  const renderRows = useCallback(
    (skills: Skill[], scope: SkillScope) =>
      skills.map((skill) =>
        editor && editor.skill?.name === skill.name && editor.scope === scope ? (
          <SkillEditor
            key={skill.name}
            skill={skill}
            scopeLabel={skill.filepath}
            onSave={handleSave}
            onCancel={() => setEditor(null)}
          />
        ) : (
          <SkillRow
            key={skill.name}
            skill={skill}
            expanded={expanded === `${scope}:${skill.name}`}
            onToggleExpand={() =>
              setExpanded((prev) =>
                prev === `${scope}:${skill.name}` ? null : `${scope}:${skill.name}`
              )
            }
            onSetEnabled={(enabled) => void setEnabled(skill.name, enabled)}
            onEdit={() => setEditor({ scope, skill })}
            onDelete={() => void remove(scope, skill.name)}
            canToggle={appName !== null}
          />
        )
      ),
    [appName, editor, expanded, handleSave, remove, setEnabled]
  )

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[15px] font-semibold text-bone">Skills</h1>
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
            className="rounded p-1.5 text-ash transition-colors hover:bg-raised hover:text-bone"
          >
            <RefreshIcon size={16} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
              className="mt-2 text-[13px] text-brass hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {warning && (
          <div className="mt-4 rounded-lg border border-brass/40 bg-brass/10 p-4">
            <p className="text-[13px] text-bone">{warning}</p>
          </div>
        )}

        {isLoading ? (
          <p className="mt-8 text-center text-[13px] text-ash">Reading skills…</p>
        ) : (
          <div className="mt-6 space-y-8">
            <SkillSection
              label={appName ? `This app · ${appName}` : 'This app'}
              count={library.app.length}
              versioned
              onAdd={appName ? () => setEditor({ scope: 'app', skill: null }) : undefined}
              addTitle={appName ? `Write a skill that lives with ${appName}` : undefined}
            >
              {editor?.scope === 'app' && editor.skill === null ? (
                <ul className="space-y-2">
                  <SkillEditor
                    skill={null}
                    scopeLabel="Committed with this app, in its skills/ folder"
                    onSave={handleSave}
                    onCancel={() => setEditor(null)}
                  />
                </ul>
              ) : !appName ? (
                <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
                  <p className="text-[13px] text-ash">
                    Open an app to see and write skills that live with it.
                  </p>
                </div>
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
                <ul className="space-y-2">{renderRows(appSkills, 'app')}</ul>
              )}
            </SkillSection>

            <SkillSection
              label="Workspace · every app"
              count={library.workspace.length}
              onAdd={() => setEditor({ scope: 'workspace', skill: null })}
              addTitle="Write a skill every app can use"
            >
              {editor?.scope === 'workspace' && editor.skill === null ? (
                <ul className="space-y-2">
                  <SkillEditor
                    skill={null}
                    scopeLabel="Shared by every app, in ~/.pitaster/skills"
                    onSave={handleSave}
                    onCancel={() => setEditor(null)}
                  />
                </ul>
              ) : workspaceSkills.length === 0 ? (
                <div className="flex flex-col items-center rounded-lg border border-dashed border-line px-4 py-8 text-center">
                  <span className="text-ash">
                    <SkillsIcon size={26} />
                  </span>
                  <p className="mt-3 text-[13px] text-bone">
                    {library.workspace.length === 0
                      ? 'No workspace skills yet.'
                      : `No skill here matches “${search}”.`}
                  </p>
                  {library.workspace.length === 0 && (
                    <p className="mt-1 text-[12px] text-ash">
                      A skill is a short instruction file the agent loads when a task
                      matches its description.
                    </p>
                  )}
                </div>
              ) : (
                <ul className="space-y-2">{renderRows(workspaceSkills, 'workspace')}</ul>
              )}
            </SkillSection>
          </div>
        )}
      </div>
    </div>
  )
}
