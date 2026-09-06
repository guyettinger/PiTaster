/**
 * The per-tool prompt guidance Pi writes but Key Lime Pi was throwing away.
 *
 * Pi builds its own system prompt from contributions attached to each tool
 * definition: a one-line `promptSnippet` and a `promptGuidelines` array. The `edit`
 * tool's four bullets are where a model learns that `edits[]` is a list of *disjoint*
 * replacements resolved against the original file, and that each `oldText` has to be
 * unique. Without them the only thing describing the tool is its JSON schema.
 *
 * Key Lime Pi supplies `systemPromptOverride`, which puts Pi's `buildSystemPrompt` on its
 * `customPrompt` early return (`dist/core/system-prompt.js:13-34`). That branch
 * appends context files, skills and the cwd — and drops `toolSnippets` and
 * `promptGuidelines` for every tool. The guidance was silently absent from every
 * request Key Lime Pi has ever made, which is the largest single cause of the repeated
 * `The old text must match exactly` failures.
 *
 * The text is read back off Pi's live definitions rather than copied here, so it
 * cannot drift when Pi revises a guideline. `create*ToolDefinition` are exported from
 * the package root and `promptSnippet`/`promptGuidelines` are public fields on
 * `ToolDefinition`, so this needs no deep import into `dist/`.
 */

import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition
} from '@earendil-works/pi-coding-agent'

/**
 * The subset of a Pi tool definition this module reads.
 *
 * Declared structurally rather than importing `ToolDefinition`, whose three type
 * parameters differ per tool and would force a cast to hold them in one array.
 */
interface GuidanceSource {
  /** One-line description of what the tool is for. */
  promptSnippet?: string
  /** Usage rules for the tool, as Pi words them. */
  promptGuidelines?: string[]
  /** The tool's own description, as sent to the model. */
  description?: string
  /** The JSON schema for the tool's arguments, as sent to the model. */
  parameters?: unknown
}

/**
 * Build the built-in tool definitions, keyed by the name the allowlist uses.
 *
 * The factories take a `cwd` because the real tools resolve paths against it. Nothing
 * here executes a tool, so the value only has to be the same root the session runs
 * against for the descriptions to be accurate.
 *
 * `powershell` is deliberately absent: Key Lime Pi never enables it.
 *
 * Exported for `context-report.ts`, which sizes the same definitions' schemas. Building
 * them is the only way to know what a tool costs without a live session, and reading
 * them back off Pi is the same reason this module exists: a number Key Lime Pi maintained by
 * hand would drift the first time Pi revised a description.
 *
 * @param rootPath - The sub-app root the session operates on
 * @returns Guidance sources by tool name
 */
export function builtinDefinitions(rootPath: string): Record<string, GuidanceSource> {
  return {
    read: createReadToolDefinition(rootPath),
    write: createWriteToolDefinition(rootPath),
    edit: createEditToolDefinition(rootPath),
    bash: createBashToolDefinition(rootPath),
    grep: createGrepToolDefinition(rootPath),
    find: createFindToolDefinition(rootPath),
    ls: createLsToolDefinition(rootPath)
  }
}

/**
 * Parameters for {@link getToolGuidelines}.
 */
export interface GetToolGuidelinesParams {
  /** The sub-app root, passed through to Pi's definition factories. */
  rootPath: string
  /** The tool names this session actually enabled. */
  toolNames: string[]
}

/**
 * Collect Pi's own guidelines for the tools a session enabled.
 *
 * Order follows {@link builtinDefinitions} rather than the caller's list, so the
 * prompt is stable across sessions with different tool profiles — a prompt that
 * reorders between requests defeats prefix caching for no benefit.
 *
 * Duplicates are dropped the way Pi drops them: several tools can contribute the same
 * sentence, and paying for it twice on a small window is the thing this module is
 * meant to be careful about.
 *
 * @param params - The app root and the session's tool names
 * @returns The guidelines, deduped, in a stable order
 */
export function getToolGuidelines(params: GetToolGuidelinesParams): string[] {
  const enabled = new Set(params.toolNames)
  const seen = new Set<string>()
  const guidelines: string[] = []

  for (const [name, definition] of Object.entries(builtinDefinitions(params.rootPath))) {
    if (!enabled.has(name)) continue

    for (const guideline of definition.promptGuidelines ?? []) {
      const normalized = guideline.trim()
      if (normalized.length === 0 || seen.has(normalized)) continue
      seen.add(normalized)
      guidelines.push(normalized)
    }
  }

  return guidelines
}

/**
 * Render the guidelines as a prompt section.
 *
 * Returns an empty string when nothing is enabled, so the caller can concatenate
 * unconditionally without leaving a stray heading behind.
 *
 * @param params - The app root and the session's tool names
 * @returns A markdown section, or an empty string
 */
export function renderToolGuidance(params: GetToolGuidelinesParams): string {
  const guidelines = getToolGuidelines(params)
  if (guidelines.length === 0) return ''

  return `\n## Tool Use\n\n${guidelines.map((line) => `- ${line}`).join('\n')}\n`
}
