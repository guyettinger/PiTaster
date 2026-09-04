/**
 * Skill types for Pi Taster.
 *
 * A skill is a folder holding a `SKILL.md`: YAML frontmatter carrying a `name` and a
 * `description`, then a markdown body. The two halves are paid for very differently,
 * which is the distinction most of this file exists to carry.
 *
 * The **description** is rendered into every request's system prompt, for every skill,
 * for the whole session. It is also the only text the model matches against when
 * deciding whether a skill applies — a skill with no description can never fire.
 *
 * The **body** costs nothing until the model calls `load_skill`, at which point it
 * arrives as a tool result.
 */

/**
 * Where a skill lives, which decides who can see it and how it is versioned.
 *
 * `app` skills live in `<app-root>/skills/`. They are inside the agent's confinement
 * boundary and are committed with the app, so they roll back with it.
 *
 * `workspace` skills live in `~/.pitaster/skills/` and are offered to every app.
 */
export type SkillScope = 'app' | 'workspace'

/**
 * The editable part of a skill — everything a user or the agent actually writes.
 *
 * Writes take this rather than {@link Skill} so a caller never has to invent the
 * derived fields.
 */
export interface SkillDraft {
  /** Skill name (kebab-case). Also the directory name. */
  name: string
  /** One line, shown to the model in every prompt. This is what makes a skill trigger. */
  description: string
  /** The markdown body, read only when the model loads the skill. */
  content: string
}

/**
 * A skill as loaded from disk, with everything the UI and the prompt need.
 */
export interface Skill extends SkillDraft {
  /** File path where the skill is stored. */
  filepath: string
  /** Which library this skill came from. */
  scope: SkillScope
  /** Whether the active app offers this skill to the model. */
  enabled: boolean
  /** Estimated tokens this skill's manifest entry costs on every request. */
  manifestTokens: number
  /** Estimated tokens the body costs when the model loads it. */
  bodyTokens: number
  /** True when the body still matches a seed Pi Taster has since corrected. */
  outdated: boolean
  /** True when a same-named app skill hides this workspace one from the model. */
  shadowed: boolean
  /**
   * Times the agent has loaded this skill in the open chat.
   *
   * Contextual like {@link Skill.enabled} and {@link Skill.shadowed}, and the only
   * evidence a user has that a skill is doing anything at all: a skill is advertised in
   * every prompt whether or not the model ever reaches for it, and until this was shown
   * there was no way to tell those apart.
   */
  loadedThisChat: number
}

/**
 * The two skill libraries available to one app.
 */
export interface SkillLibrary {
  /** Skills from the open app's own `skills/` directory. */
  app: Skill[]
  /** Skills from `~/.pitaster/skills/`, shared by every app. */
  workspace: Skill[]
}

/**
 * The result of a change to a skill library.
 *
 * Carries a warning as well as the new state, because a skill change can half-succeed:
 * the file is written and the agent will see it, but the commit that makes an app skill
 * *versioned* — which is what the panel calls it — did not happen. Losing that quietly
 * would leave the user believing a rollback covers a skill it does not.
 */
export interface SkillLibraryUpdate {
  /** Both libraries, reloaded. */
  library: SkillLibrary
  /** What went wrong alongside a change that otherwise succeeded. */
  warning?: string
}

/**
 * Skill mention in a message.
 */
export interface SkillMention {
  /** The mentioned skill name. */
  name: string
  /** Start index in message. */
  start: number
  /** End index in message. */
  end: number
}
