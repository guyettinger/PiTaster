import { useCallback, useState } from 'react'
import { ChevronDownIcon, PencilIcon, TrashIcon } from '../icons'
import { Markdown } from '../Markdown'
import type { Skill } from '@pitaster/core'

/**
 * Props for the SkillRow component.
 */
interface SkillRowProps {
  /** The skill to show. */
  skill: Skill
  /** Whether the body is showing. */
  expanded: boolean
  /** Show or hide the body. */
  onToggleExpand: () => void
  /** Turn the skill on or off for the open app. */
  onSetEnabled: (enabled: boolean) => void
  /** Open the editor for this skill. */
  onEdit: () => void
  /** Delete the skill. */
  onDelete: () => void
  /** Whether the app that owns the on/off state is open. */
  canToggle: boolean
}

/**
 * One skill, drawn in the two registers the model actually receives it in.
 *
 * A skill is not one document. Its **description** rides in every request for the whole
 * session and is the only text a task is matched against; its **body** costs nothing
 * until `load_skill` fetches it. Nothing in the app used to say so, and the result was
 * skills written like documentation — a title, a summary, and no trigger words — which
 * a model has no way to reach for.
 *
 * So the row is labelled by cost: the always-sent half above the rule, the on-demand
 * half below it, each with its own token count. The eyebrows are the teaching, and they
 * cost one line.
 *
 * Colour follows the shell's rule that brass is the agent acting. A skill at rest is
 * neutral no matter how important it is; a skill the agent has *loaded in this chat*
 * takes the brass leading bar, because that is the one thing on this page that is an
 * action rather than a setting.
 */
export function SkillRow({
  skill,
  expanded,
  onToggleExpand,
  onSetEnabled,
  onEdit,
  onDelete,
  canToggle
}: SkillRowProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const handleDelete = useCallback(() => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      window.setTimeout(() => setConfirmingDelete(false), 3000)
      return
    }
    onDelete()
  }, [confirmingDelete, onDelete])

  const loaded = skill.loadedThisChat > 0
  const inactive = !skill.enabled || skill.shadowed

  return (
    <li className="relative overflow-hidden rounded-lg border border-line bg-panel">
      {/* The load trace. Brass, and only ever this. */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 h-full w-0.5 bg-brass transition-opacity ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* `relative` scopes the name button's stretched hit area to the header. Without
          it the stretch resolves against the <li>, so it also covers the expanded body —
          and clicking the instructions, or selecting text in them, collapsed the row. */}
      <div className="relative px-4 py-3">
        {/* The eyebrow slot carries only what varies. Repeating "in every prompt" on
            every row turned it into wallpaper — the page header states the rule once,
            and this line appears when there is actually something to say: the agent
            reached for this skill, or the app has overridden it. Expanding restores the
            label, because that is where it contrasts with the on-demand half below. */}
        {(loaded || skill.shadowed || expanded) && (
          <span
            className={`eyebrow block ${loaded ? 'text-brass' : skill.shadowed ? 'text-rust' : 'text-ash'}`}
          >
            {skill.shadowed
              ? 'Hidden by this app'
              : loaded
                ? `Loaded ${skill.loadedThisChat}× this chat`
                : 'In every prompt'}
          </span>
        )}

        <div className={`flex items-center gap-3 ${loaded || skill.shadowed || expanded ? 'mt-1.5' : ''}`}>
          <button
            onClick={onToggleExpand}
            aria-expanded={expanded}
            className={`min-w-0 flex-1 truncate text-left font-mono text-[13px] after:absolute after:inset-0 ${
              inactive ? 'text-ash' : 'text-bone'
            }`}
          >
            {skill.name}
          </button>

          {skill.scope === 'app' && (
            <span className="eyebrow shrink-0 text-patina">Versioned</span>
          )}
          {skill.outdated && <span className="eyebrow shrink-0 text-rust">Outdated</span>}
          {skill.description.length === 0 && (
            <span className="eyebrow shrink-0 text-rust">Never triggers</span>
          )}

          <span
            title={`${skill.manifestTokens} tokens in every request`}
            className="shrink-0 font-mono text-[11px] tabular-nums text-ash"
          >
            {inactive ? '0' : skill.manifestTokens} tk
          </span>

          <button
            onClick={() => onSetEnabled(!skill.enabled)}
            aria-pressed={skill.enabled}
            disabled={!canToggle}
            title={
              canToggle
                ? skill.enabled
                  ? `Stop offering ${skill.name} to the agent`
                  : `Offer ${skill.name} to the agent`
                : 'Open an app to turn a skill on or off'
            }
            className="relative z-10 shrink-0 rounded p-1.5 transition-colors hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <span
              aria-hidden="true"
              className={`block h-2.5 w-2.5 rounded-full border transition-colors ${
                skill.enabled ? 'border-bone bg-bone' : 'border-line'
              }`}
            />
          </button>

          <ChevronDownIcon
            size={16}
            aria-hidden="true"
            className={`shrink-0 text-ash transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>

        <p className={`mt-1 max-w-prose text-[13px] ${inactive ? 'text-ash' : 'text-bone'}`}>
          {skill.description || 'No description, so the agent can never match a task to it.'}
        </p>

        {skill.shadowed && (
          <p className="mt-1.5 text-[12px] text-ash">
            This app has its own <span className="font-mono">{skill.name}</span>, which the
            agent gets instead.
          </p>
        )}
      </div>

      {expanded && (
        <div className="border-t border-line bg-ground">
          <div className="flex items-baseline justify-between gap-3 px-4 pt-3">
            <span className="eyebrow text-ash">Loaded on demand</span>
            <span className="font-mono text-[11px] tabular-nums text-ash">
              {skill.bodyTokens} tk
            </span>
          </div>

          <div className="max-h-80 overflow-auto px-4 py-2">
            {skill.content.length > 0 ? (
              <Markdown content={skill.content} />
            ) : (
              <p className="text-[13px] text-ash">This skill has no instructions yet.</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2">
            <span className="truncate font-mono text-[11px] text-ash">{skill.filepath}</span>
            <div className="relative z-10 flex shrink-0 items-center gap-1">
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] text-ash transition-colors hover:bg-raised hover:text-bone"
              >
                <PencilIcon size={14} />
                Edit
              </button>
              <button
                onClick={handleDelete}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] transition-colors ${
                  confirmingDelete
                    ? 'bg-rust/15 text-rust'
                    : 'text-ash hover:bg-raised hover:text-bone'
                }`}
              >
                <TrashIcon size={14} />
                {confirmingDelete ? 'Confirm' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  )
}
