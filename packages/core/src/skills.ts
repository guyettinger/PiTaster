/**
 * Skill types for CLIRabbit.
 */

/**
 * A skill definition.
 */
export interface Skill {
  /** Skill name (kebab-case). */
  name: string
  /** Short description. */
  description: string
  /** Full instruction content. */
  content: string
  /** File path where skill is stored. */
  filepath: string
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
