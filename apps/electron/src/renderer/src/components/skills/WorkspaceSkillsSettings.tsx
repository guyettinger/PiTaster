import { useCallback, useMemo, useState } from 'react'
import { RefreshIcon, SearchIcon, SkillsIcon } from '../icons'
import { useSkills } from '../../hooks/useSkills'
import { filterSkills } from './filterSkills'
import { SkillEditor } from './SkillEditor'
import { SkillRow } from './SkillRow'
import type { Skill, SkillDraft } from '@pitaster/core'

/**
 * The workspace skill library, as Settings authors it.
 *
 * These live in `~/.pitaster/skills` and are offered to every app, which is what
 * makes Settings their home: they belong to the workspace, not to whichever app
 * happens to be focused.
 *
 * There are deliberately **no on/off toggles here.** Enabled-ness is
 * `SubApp.disabledSkills` — per app — so a toggle on this page would have to ask
 * "for which app?" and answer with a picker duplicating the nav rail. The app's
 * own Skills panel already has an app in scope, and that is where the toggle
 * lives. This page answers the other question: what is in the library, what does
 * each skill's description cost, and what does its body say.
 */
export function WorkspaceSkillsSettings() {
  // `null`: this page is the workspace library, which belongs to no app.
  const { library, isLoading, error, warning, reload, save, remove } = useSkills(null)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [editing, setEditing] = useState<Skill | null>(null)

  const skills = useMemo(
    () => filterSkills(library.workspace, search),
    [library.workspace, search]
  )

  const handleSave = useCallback(
    async (draft: SkillDraft) => {
      await save('workspace', draft)
      setIsAdding(false)
      setEditing(null)
      setExpanded(draft.name)
    },
    [save]
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold text-bone">Skills</h2>
          <p className="max-w-prose text-[12px] text-ash">
            Instructions offered to every app, in{' '}
            <code className="font-mono">~/.pitaster/skills</code>. Turn them on or off per
            app from that app’s Skills panel.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => void reload()}
            aria-label="Reload skills"
            title="Re-read the skills folder"
            className="rounded p-1.5 text-ash transition-colors hover:bg-raised hover:text-bone"
          >
            <RefreshIcon size={16} />
          </button>
          <button
            onClick={() => {
              setEditing(null)
              setIsAdding(true)
            }}
            className="rounded-lg bg-keylime px-3 py-1.5 text-[13px] font-medium text-ground transition-opacity hover:opacity-90"
          >
            New skill
          </button>
        </div>
      </div>

      <div className="relative max-w-xl">
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
        <div className="rounded-lg border border-rust/40 bg-rust/10 p-4">
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
        <div className="rounded-lg border border-keylime/40 bg-keylime/10 p-4">
          <p className="text-[13px] text-bone">{warning}</p>
        </div>
      )}

      {isAdding && (
        <ul className="space-y-2">
          <SkillEditor
            skill={null}
            scopeLabel="Shared by every app, in ~/.pitaster/skills"
            onSave={handleSave}
            onCancel={() => setIsAdding(false)}
          />
        </ul>
      )}

      {isLoading ? (
        <p className="py-8 text-center text-[13px] text-ash">Reading skills…</p>
      ) : skills.length === 0 && !isAdding ? (
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
            <p className="mt-1 max-w-prose text-[12px] text-ash">
              A skill is a short instruction file the agent loads when a task matches its
              description.
            </p>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {skills.map((skill) =>
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
                expanded={expanded === skill.name}
                onToggleExpand={() =>
                  setExpanded((prev) => (prev === skill.name ? null : skill.name))
                }
                /*
                  Never called: `showEnabledState` removes the control. On/off is
                  `SubApp.disabledSkills`, so it belongs to an app, and this page
                  has none — showing it here would report one app's decision as
                  though it were a property of the library.
                */
                onSetEnabled={() => {}}
                onEdit={() => {
                  setIsAdding(false)
                  setEditing(skill)
                }}
                onDelete={() => void remove('workspace', skill.name)}
                canToggle={false}
                showEnabledState={false}
              />
            )
          )}
        </ul>
      )}
    </div>
  )
}
