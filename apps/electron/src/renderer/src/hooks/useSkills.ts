import { useCallback, useEffect, useState } from 'react'
import type { Skill, SkillDraft, SkillLibrary, SkillLibraryUpdate, SkillScope } from '@pitaster/core'

/** An empty library, used before the first load and after a failure. */
const EMPTY_LIBRARY: SkillLibrary = { app: [], workspace: [] }

/**
 * What {@link useSkills} returns.
 */
export interface UseSkillsResult {
  /** Both libraries for the open app. */
  library: SkillLibrary
  /** True until the first load settles. */
  isLoading: boolean
  /** The last failure, or null. */
  error: string | null
  /**
   * A change that landed but not completely, or null.
   *
   * Distinct from {@link UseSkillsResult.error} because the two need different answers:
   * an error means the change did not happen, a warning means it did and something else
   * did not — an app skill written to disk but not committed, say. Reporting the second
   * as the first would have the user rewrite work that is already saved.
   */
  warning: string | null
  /** Re-read both libraries from disk. */
  reload: () => Promise<void>
  /** Create or overwrite a skill. */
  save: (scope: SkillScope, draft: SkillDraft) => Promise<void>
  /** Delete a skill and its directory. */
  remove: (scope: SkillScope, name: string) => Promise<void>
  /** Turn a skill on or off for the open app. */
  setEnabled: (name: string, enabled: boolean) => Promise<void>
}

/**
 * The skill libraries, and everything that changes them.
 *
 * Every mutation returns the reloaded libraries from main rather than patching state
 * here, because a save can change more than the skill saved: an app skill that takes a
 * workspace skill's name shadows it, and both rows have to move at once.
 *
 * @param appId - The app whose library this is, or null for the workspace library
 *   alone. It selects which `skills:changed` pushes this subscriber acts on; a
 *   workspace-scoped change reaches every subscriber, since a workspace skill is
 *   offered to every app.
 * @returns The libraries, their load state, and the mutations
 */
export function useSkills(appId: string | null): UseSkillsResult {
  const [library, setLibrary] = useState<SkillLibrary>(EMPTY_LIBRARY)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setError(null)
      setWarning(null)
      setLibrary(await window.electronAPI.getSkills())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Skills could not be read')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()

    // The agent can write a skill mid-turn, and loading one changes its count.
    return window.electronAPI.onSkillsChanged(appId, () => {
      void reload()
    })
  }, [appId, reload])

  /**
   * Run a mutation and adopt the libraries it returns.
   * @param mutate - The bridge call to make
   */
  const apply = useCallback(async (mutate: () => Promise<SkillLibraryUpdate>) => {
    try {
      setError(null)
      const update = await mutate()
      setLibrary(update.library)
      setWarning(update.warning ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved')
      throw err
    }
  }, [])

  const save = useCallback(
    async (scope: SkillScope, draft: SkillDraft) => {
      await apply(() => window.electronAPI.saveSkill({ scope, draft }))
    },
    [apply]
  )

  const remove = useCallback(
    async (scope: SkillScope, name: string) => {
      await apply(() => window.electronAPI.deleteSkill({ scope, name }))
    },
    [apply]
  )

  const setEnabled = useCallback(
    async (name: string, enabled: boolean) => {
      await apply(async () => ({ library: await window.electronAPI.setSkillEnabled({ name, enabled }) }))
    },
    [apply]
  )

  return { library, isLoading, error, warning, reload, save, remove, setEnabled }
}

/**
 * The tokens a set of skills costs in every request.
 *
 * Only the ones that actually go out: a skill turned off, shadowed, or missing a
 * description is not in the manifest and costs nothing.
 *
 * @param skills - Skills from either library
 * @returns Estimated tokens per request
 */
export function manifestCost(skills: Skill[]): number {
  return skills.reduce(
    (total, skill) =>
      skill.enabled && !skill.shadowed && skill.description.length > 0
        ? total + skill.manifestTokens
        : total,
    0
  )
}
