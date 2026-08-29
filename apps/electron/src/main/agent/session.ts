/**
 * Pi agent session host.
 *
 * anyapp runs one Pi `AgentSession` per active sub-app. The session owns the agent
 * loop, the tools, the transcript, and the model connection; this module owns the
 * anyapp-specific parts bolted onto it — the permission gate, git auto-commit, the
 * version tools, and the system prompt.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  createAgentSession,
  createSyntheticSourceInfo,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionAPI,
  type InlineExtension,
  type Skill as PiSkill
} from '@earendil-works/pi-coding-agent'
import type {
  ConnectedSource,
  ElementContext,
  PermissionMode,
  StreamChunk,
  SubApp
} from '@anyapp/core'
import { SkillsLoader } from '@anyapp/shared'
import { autoCommitToolResult } from './auto-commit'
import { toStreamChunk } from './events'
import { createMcpTools, getMcpToolBindings, type CallMcpTool } from './mcp-tools'
import {
  checkConfinement,
  checkPermission,
  resolveLikePi
} from './permission-gate'
import { getSystemPrompt } from './system-prompt'
import { createVersionTools, VERSION_TOOL_NAMES } from './version-tools'
import { elementContextToPrompt } from '../agent-utils'

/**
 * The tools every session starts with: Pi's built-ins plus anyapp's version tools.
 *
 * Pi's `tools` option is an allowlist that applies to custom tools too, so every
 * version tool has to be named here or it is filtered out. Keep this in step with
 * the tool list in {@link getSystemPrompt} and the classifications in
 * {@link checkPermission}.
 *
 * Tools from connected MCP sources are *not* listed here — their names depend on
 * what is connected, so {@link createAgentHost} appends them per session.
 */
export const AGENT_TOOL_NAMES = [
  'read',
  'write',
  'edit',
  'bash',
  'grep',
  'find',
  'ls',
  ...VERSION_TOOL_NAMES
]

/**
 * Callbacks the host needs from the surrounding application.
 */
export interface AgentHostCallbacks {
  /** Current permission mode. */
  getPermissionMode: () => PermissionMode
  /** Whether auto-commit is enabled. */
  getAutoCommit: () => boolean
  /** Ask the user to approve one tool call. Resolves false on denial or timeout. */
  requestApproval: (tool: string, input: unknown) => Promise<boolean>
  /** Invoke a tool on a connected MCP source. */
  callMcpTool: CallMcpTool
  /** Forward a chunk to the renderer. */
  onStream: (chunk: StreamChunk) => void
}

/**
 * Parameters for {@link createAgentHost}.
 */
export interface CreateAgentHostParams {
  /** The sub-app this session operates on. */
  app: SubApp
  /** Pi agent directory, holding models.json, settings and session transcripts. */
  agentDir: string
  /** Model tag to run, for example `qwen3-coder:30b`. */
  modelId: string
  /** Existing Pi session file to resume, or undefined to start a new one. */
  sessionFile?: string
  /** Currently connected MCP sources, whose tools join this session. */
  mcpSources?: ConnectedSource[]
  /** Application callbacks. */
  callbacks: AgentHostCallbacks
}

/**
 * A live agent session bound to one sub-app.
 */
export interface AgentHost {
  /** Send a prompt and resolve when the run finishes. */
  sendPrompt: (params: SendPromptParams) => Promise<void>
  /** Cancel the in-flight run. */
  abort: () => Promise<void>
  /** Absolute path to this session's transcript file, when persisted. */
  sessionFile: string | undefined
  /** Pi's identifier for this session. */
  sessionId: string
  /** The sub-app this host is bound to. */
  appId: string
  /** Release the session and its listeners. */
  dispose: () => void
}

/**
 * Parameters for {@link AgentHost.sendPrompt}.
 */
export interface SendPromptParams {
  /** The user's message text. */
  text: string
  /** Selected UI elements to attach as context. */
  elements?: ElementContext[]
}

/**
 * Resolve the directory holding one sub-app's session transcripts.
 *
 * Pi defaults this to `~/.pi/agent/sessions/`, which would scatter anyapp's data
 * outside `~/.anyapp/`. The `--<escaped cwd>--` naming mirrors Pi's own scheme so
 * the directories stay recognisable.
 *
 * @param agentDir - The Pi agent directory, for example `~/.anyapp/pi`
 * @param appPath - Absolute path to the sub-app root
 * @returns Absolute path to the session directory for that app
 */
export function getAppSessionDir(agentDir: string, appPath: string): string {
  const slug = `--${resolve(appPath).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return join(agentDir, 'sessions', slug)
}

/**
 * Map anyapp's runtime skills onto Pi's skill shape.
 * @param skillsDir - Directory holding `<name>/SKILL.md` entries
 * @returns Pi skills, or an empty array when none load
 */
async function loadPiSkills(skillsDir: string): Promise<PiSkill[]> {
  try {
    const skills = await new SkillsLoader(skillsDir).loadAll()
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      filePath: skill.filepath,
      baseDir: join(skillsDir, skill.name),
      sourceInfo: createSyntheticSourceInfo(skill.filepath, {
        source: 'anyapp',
        scope: 'user',
        origin: 'top-level',
        baseDir: join(skillsDir, skill.name)
      }),
      // anyapp skills are activated by @mention, but leaving them model-invocable
      // preserves the previous behaviour where a mentioned skill shaped the turn.
      disableModelInvocation: false
    }))
  } catch {
    // Skills are optional; a missing or malformed directory must not block the agent.
    return []
  }
}

/**
 * Build the inline extension carrying anyapp's permission gate and auto-commit.
 *
 * With Pi's built-in tools adopted unmodified, the `tool_call` handler below is the
 * only boundary between the model and the filesystem.
 *
 * @param params - The app root and the host callbacks
 * @returns A named inline extension for the resource loader
 */
function createAnyappExtension(params: {
  /** Absolute path to the sub-app root. */
  rootPath: string
  /** Application callbacks. */
  callbacks: AgentHostCallbacks
}): InlineExtension {
  const { rootPath, callbacks } = params

  return {
    name: 'anyapp-guard',
    factory: (pi: ExtensionAPI) => {
      pi.on('tool_call', async (event) => {
        const call = {
          toolName: event.toolName,
          input: event.input as Record<string, unknown>
        }

        const violation = checkConfinement(call, rootPath)
        if (violation) {
          return { block: true, reason: violation }
        }

        const decision = checkPermission(callbacks.getPermissionMode(), event.toolName)
        if (decision.behavior === 'deny') {
          return { block: true, reason: decision.message ?? 'Denied' }
        }
        if (decision.behavior === 'ask') {
          const approved = await callbacks.requestApproval(event.toolName, event.input)
          if (!approved) {
            return { block: true, reason: 'Denied by user' }
          }
        }

        return undefined
      })

      pi.on('tool_result', async (event) => {
        const path = (event.input as { path?: unknown }).path
        if (typeof path !== 'string') return undefined

        const outcome = await autoCommitToolResult({
          result: {
            toolName: event.toolName,
            input: event.input as Record<string, unknown>,
            isError: event.isError === true
          },
          rootPath,
          enabled: callbacks.getAutoCommit(),
          absolutePath: resolveLikePi(path, rootPath)
        })

        if (outcome.note) {
          return {
            content: [...event.content, { type: 'text' as const, text: outcome.note }]
          }
        }
        return undefined
      })
    }
  }
}

/**
 * Create a Pi agent session bound to one sub-app.
 * @param params - The app, model, Pi directory, and application callbacks
 * @returns A live {@link AgentHost}
 * @throws {Error} If the configured model is not available from Ollama
 */
export async function createAgentHost(params: CreateAgentHostParams): Promise<AgentHost> {
  const { app, agentDir, modelId, sessionFile, mcpSources = [], callbacks } = params

  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json')
  })

  const model = modelRuntime.getModel('ollama', modelId)
  if (!model) {
    throw new Error(
      `Model "${modelId}" is not available from Ollama. Pull it with \`ollama pull ${modelId}\`, or pick another model in Settings.`
    )
  }

  const settingsManager = SettingsManager.create(app.path, agentDir)

  const anyappSkills = await loadPiSkills(join(homedir(), '.anyapp', 'skills'))

  const mcpBindings = getMcpToolBindings(mcpSources)
  const mcpTools = createMcpTools({ sources: mcpSources, callTool: callbacks.callMcpTool })

  const loader = new DefaultResourceLoader({
    cwd: app.path,
    agentDir,
    settingsManager,
    systemPromptOverride: () => getSystemPrompt({ app, mcpTools: mcpBindings }),
    skillsOverride: (current) => ({
      skills: [...current.skills, ...anyappSkills],
      diagnostics: current.diagnostics
    }),
    extensionFactories: [createAnyappExtension({ rootPath: app.path, callbacks })]
  })

  await loader.reload()

  const sessionDir = getAppSessionDir(agentDir, app.path)
  const sessionManager = sessionFile
    ? SessionManager.open(sessionFile, sessionDir)
    : SessionManager.create(app.path, sessionDir)

  const { session } = await createAgentSession({
    cwd: app.path,
    agentDir,
    model,
    modelRuntime,
    thinkingLevel: 'off',
    noTools: 'all',
    tools: [...AGENT_TOOL_NAMES, ...mcpBindings.map((binding) => binding.qualifiedName)],
    customTools: [...createVersionTools(app.path), ...mcpTools],
    resourceLoader: loader,
    sessionManager,
    settingsManager
  })

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    const chunk = toStreamChunk(event)
    if (chunk) callbacks.onStream(chunk)
  })

  return {
    sessionFile: session.sessionFile,
    sessionId: session.sessionId,
    appId: app.id,

    sendPrompt: async ({ text, elements }: SendPromptParams) => {
      const { prompt, images } = elementContextToPrompt({ text, elements: elements ?? [] })
      await session.prompt(prompt, images.length > 0 ? { images } : undefined)
    },

    abort: async () => {
      await session.abort()
    },

    dispose: () => {
      unsubscribe()
      session.dispose()
    }
  }
}

/**
 * The live session type, re-exported for callers that hold one.
 */
export type { AgentSession }
