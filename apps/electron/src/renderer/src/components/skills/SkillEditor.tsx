import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import type { Skill, SkillDraft } from '@keylimepi/core'

/** How a skill name must be spelled, matching the loader and the IPC handlers. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Longest description accepted, matching the IPC handler. */
const MAX_DESCRIPTION = 500

/**
 * Props for the SkillEditor component.
 */
interface SkillEditorProps {
  /** The skill being edited, or null when writing a new one. */
  skill: Skill | null
  /** Where the skill will be written. */
  scopeLabel: string
  /** Save the draft. */
  onSave: (draft: SkillDraft) => Promise<void>
  /** Close without saving. */
  onCancel: () => void
}

/**
 * Props for the Field component.
 */
interface FieldProps {
  /** The field's label. */
  label: string
  /** What this field is for, in terms of what the model does with it. */
  hint: string
  /** The input. */
  children: ReactNode
}

/**
 * One labelled field.
 *
 * The hint says what the model does with the value, not what the field is. A user
 * writing their first skill has no way to know that the description is the trigger and
 * the body is not, and that is the single thing that decides whether a skill ever fires.
 */
function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="block">
      <span className="eyebrow text-ash">{label}</span>
      <span className="mt-1 block max-w-prose text-[12px] text-ash">{hint}</span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

/** Shared input styling. */
const INPUT_CLASS =
  'w-full rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-bone placeholder-ash transition-colors hover:border-ash'

/**
 * Write or change a skill.
 *
 * Renders in place of the row it belongs to, the way `AddSourceForm` does inside
 * `SourcesPanel`, so the list never jumps and the skill being changed stays where the
 * user left it.
 *
 * The name is fixed once a skill exists: it is the directory name, so changing it would
 * be a move rather than an edit, and a half-done move leaves two skills.
 */
export function SkillEditor({ skill, scopeLabel, onSave, onCancel }: SkillEditorProps) {
  const [name, setName] = useState(skill?.name ?? '')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [content, setContent] = useState(skill?.content ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isNew = skill === null
  const nameIsValid = NAME_PATTERN.test(name)

  const handleSave = useCallback(async () => {
    if (!nameIsValid) {
      setError('Use lowercase letters, numbers and hyphens.')
      return
    }
    if (description.trim().length === 0) {
      setError('A description is what makes the skill trigger. Write one line.')
      return
    }

    setIsSaving(true)
    try {
      await onSave({ name, description: description.trim(), content })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That skill could not be saved')
    } finally {
      setIsSaving(false)
    }
  }, [content, description, name, nameIsValid, onSave])

  return (
    <li className="rounded-lg border border-keylime/40 bg-keylime/5 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow text-keylime">{isNew ? 'New skill' : `Editing ${skill.name}`}</span>
        <span className="text-[12px] text-ash">{scopeLabel}</span>
      </div>

      <div className="mt-4 space-y-4">
        <Field label="Name" hint="Lowercase, hyphenated. It is also the folder name.">
          {isNew ? (
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="add-endpoint"
              autoFocus
              className={`${INPUT_CLASS} font-mono`}
            />
          ) : (
            <span className="block font-mono text-[13px] text-ash">
              {name} — a name is a folder, so it cannot be changed here. Delete and rewrite
              to rename.
            </span>
          )}
        </Field>

        <Field
          label="Description"
          hint="Shown to the model in every prompt. This is the only thing that makes the skill trigger, so name what a request would actually say."
        >
          <input
            type="text"
            value={description}
            maxLength={MAX_DESCRIPTION}
            onChange={(event) => setDescription(event.target.value.replace(/[\r\n]/g, ' '))}
            placeholder="Add a REST endpoint to this app's server. Use when adding a new route."
            className={INPUT_CLASS}
          />
        </Field>

        <Field
          label="Instructions"
          hint="Read only when the agent loads this skill, so length costs nothing until then."
        >
          <textarea
            value={content}
            rows={10}
            onChange={(event) => setContent(event.target.value)}
            placeholder={'# Add an Endpoint\n\n1. …'}
            className={`${INPUT_CLASS} resize-y font-mono leading-relaxed`}
          />
        </Field>
      </div>

      {error && <p className="mt-3 text-[13px] text-rust">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-lg bg-keylime px-4 py-2 text-[13px] font-medium text-ground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save skill'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-line px-4 py-2 text-[13px] text-ash transition-colors hover:border-ash hover:text-bone"
        >
          Cancel
        </button>
      </div>
    </li>
  )
}
