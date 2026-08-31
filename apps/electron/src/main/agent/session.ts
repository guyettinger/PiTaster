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
  ContextUsage,
  ElementContext,
  PermissionMode,
  StreamChunk,
  SubApp
} from '@anyapp/core'
import { SkillsLoader } from '@anyapp/shared'
import { autoCommitToolResult } from './auto-commit'
import { deriveContextBudget, type ContextBudget } from './context-budget'
import { trimContext } from './context-trim'
import { createLoopGuard } from './loop-guard'
import { createStallNotifier } from './stall-notifier'
import { toStreamChunk } from './events'
import { createMcpTools, getMcpToolBindings, type CallMcpTool } from './mcp-tools'
import {
  checkConfinement,
  checkPermission,
  resolveLikePi
} from './permission-gate'
import { getSystemPrompt } from './system-prompt'
import { createVersionTools, VERSION_TOOL_NAMES } from './version-tools'
import { createWebTools, WEB_TOOL_NAMES } from './web-tools'
import { elementContextToPrompt } from '../agent-utils'

/**
 * The tools every session starts with: Pi's built-ins plus anyapp's version and
 * network tools.
 *
 * Pi's `tools` option is an allowlist that applies to custom tools too, so every
 * custom tool has to be named here or it is filtered out. Keep this in step with
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
  ...VERSION_TOOL_NAMES,
  ...WEB_TOOL_NAMES
]

/**
 * Version tools dropped from the lean profile.
 *
 * Every tool costs context on every request — its name, description and JSON schema
 * ride in the function-calling payload — and a long list measurably worsens which
 * tool a small model picks. These four are the cheapest to lose: the agent rarely
 * needs them mid-task, and the user drives all of them from the Version Control
 * panel. `git_status` and `rollback` stay, because the agent does reach for those.
 *
 * This only ever *removes* names from the allowlist. Nothing here changes what a tool
 * may do, or how `checkPermission` and `checkConfinement` classify it.
 */
const LEAN_PROFILE_OMITS = ['create_branch', 'switch_branch', 'list_branches', 'get_history']

/** Window at or below which the lean tool profile is chosen automatically. */
const LEAN_PROFILE_WINDOW = 32768

/** Which tools a session exposes. */
export type ToolProfile = 'auto' | 'lean' | 'full'

/**
 * Resolve the tool list for a session.
 * @param params - The requested profile and the session's context window
 * @returns The base tool names to enable
 */
export function resolveToolNames(params: {
  /** The configured profile. */
  profile: ToolProfile
  /** The session's effective context window. */
  contextWindow: number
}): string[] {
  const lean =
    params.profile === 'lean' ||
    (params.profile === 'auto' && params.contextWindow <= LEAN_PROFILE_WINDOW)

  return lean
    ? AGENT_TOOL_NAMES.filter((name) => !LEAN_PROFILE_OMITS.includes(name))
    : AGENT_TOOL_NAMES
}

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
  /**
   * The context budget for that model.
   *
   * Defaults to a conservative derivation when omitted, which is safe but pessimistic
   * — callers that have probed the daemon should pass what they found.
   */
  budget?: ContextBudget
  /** Which tools to expose. Defaults to picking from the context window. */
  toolProfile?: ToolProfile
  /** Whether to shape the context sent to the model. Defaults to on. */
  trimContext?: boolean
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
 * The settings shape `SettingsManager.applyOverrides` accepts.
 *
 * Pi does not export its `Settings` interface from the package root, so it is read
 * back off the method that consumes it. That also means this stays correct if Pi
 * changes the shape.
 */
type PiSettingsOverrides = Parameters<SettingsManager['applyOverrides']>[0]

/**
 * Retries Pi should make when the local daemon fails a request.
 *
 * A local daemon fails differently from a hosted API: no rate limits, but connection
 * refused while it restarts, a 500 when it runs out of memory, and long stalls while
 * it swaps another model out. Those recover in seconds, so a handful of attempts with
 * a couple of seconds between them is the right shape.
 */
const LOCAL_RETRY_ATTEMPTS = 4

/** Backoff base. Pi doubles this per attempt. */
const LOCAL_RETRY_BASE_DELAY_MS = 2000

/**
 * How long a request may go without producing bytes before Pi gives up.
 *
 * Prefill on a large context is exactly that: minutes of silence with nothing on the
 * wire. The stall heartbeat, not this timeout, is what tells the user something is
 * happening.
 */
const HTTP_IDLE_TIMEOUT_MS = 600_000

/**
 * What the agent is told after its history has been summarized away.
 *
 * Compaction is where a long task quietly goes wrong on a small model: the plan was
 * in the messages that just got replaced by a paragraph. NOTES.md is on disk, so it
 * survives — but only if the agent remembers to look.
 */
const COMPACTION_NOTICE =
  'Your earlier conversation was summarized to free up context. If NOTES.md exists in ' +
  'the app root, read it before continuing — it holds the goal and the remaining steps.'

/**
 * Translate a context budget into the Pi settings that enforce it.
 *
 * Pi's own `DEFAULT_COMPACTION_SETTINGS` reserves 16384 tokens and retains 20000 —
 * 36k of budget, which is more than the whole window on the models anyapp targets.
 * Left alone it either never compacts or compacts in a loop.
 *
 * Provider-level retries are disabled deliberately. Pi's own retry policy is the one
 * that emits `auto_retry_*` events; retries underneath it are invisible and turn a
 * recoverable failure into a longer, unexplained wait.
 *
 * @param budget - The resolved context budget for this session's model
 * @returns Settings to layer over Pi's own, without persisting them
 */
export function buildPiSettings(budget: ContextBudget): PiSettingsOverrides {
  return {
    compaction: budget.compaction,
    retry: {
      enabled: true,
      maxRetries: LOCAL_RETRY_ATTEMPTS,
      baseDelayMs: LOCAL_RETRY_BASE_DELAY_MS,
      provider: { maxRetries: 0 }
    },
    httpIdleTimeoutMs: HTTP_IDLE_TIMEOUT_MS
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
  /** The session's context budget. */
  budget: ContextBudget
  /** Whether to shape the context sent to the model. */
  trimEnabled: boolean
  /** Application callbacks. */
  callbacks: AgentHostCallbacks
}): InlineExtension {
  const { rootPath, budget, trimEnabled, callbacks } = params
  const loopGuard = createLoopGuard()

  return {
    name: 'anyapp-guard',
    factory: (pi: ExtensionAPI) => {
      // A new user prompt always breaks a loop, so the streak starts over.
      //
      // Deliberately `agent_start`, not `turn_start`. Pi emits `turn_start` once per
      // inner-loop round — assistant response plus its tool calls — which is exactly
      // the granularity a stuck model repeats at, so resetting there would clear the
      // streak between every repetition and the guard could never fire.
      // `agent_start` fires once per submitted prompt.
      pi.on('agent_start', async () => {
        loopGuard.reset()
        return undefined
      })

      // Shape what the model sees, never what is stored. The transcript, git history
      // and the chat UI keep the whole conversation regardless.
      if (trimEnabled) {
        pi.on('context', async (event) => ({
          messages: trimContext(event.messages, {
            maxToolResultTokens: budget.maxToolResultTokens
          })
        }))
      }

      pi.on('tool_call', async (event) => {
        const call = {
          toolName: event.toolName,
          input: event.input as Record<string, unknown>
        }

        const violation = checkConfinement(call, rootPath)
        if (violation) {
          return { block: true, reason: violation }
        }

        // A narrowing only: this can refuse a call the gate would have allowed, never
        // allow one it would have refused.
        const loop = loopGuard.check(event.toolName, event.input)
        if (loop.blocked) {
          return { block: true, reason: loop.reason ?? 'Repeated call blocked' }
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
 * Read how full the context window is, in anyapp's shape.
 *
 * Pi reports null tokens immediately after a compaction, before the next response
 * re-establishes usage; there is nothing honest to show until then, so the field is
 * simply absent.
 *
 * @param session - The live Pi session
 * @returns A partial chunk carrying usage, or an empty object when it is unknown
 */
function readContextUsage(session: AgentSession): { contextUsage?: ContextUsage } {
  const usage = session.getContextUsage()
  if (!usage || usage.tokens === null) return {}
  return { contextUsage: { used: usage.tokens, window: usage.contextWindow } }
}

/**
 * Create a Pi agent session bound to one sub-app.
 * @param params - The app, model, Pi directory, and application callbacks
 * @returns A live {@link AgentHost}
 * @throws {Error} If the configured model is not available from Ollama
 */
export async function createAgentHost(params: CreateAgentHostParams): Promise<AgentHost> {
  const {
    app,
    agentDir,
    modelId,
    budget = deriveContextBudget(),
    toolProfile = 'auto',
    trimContext: trimEnabled = true,
    sessionFile,
    mcpSources = [],
    callbacks
  } = params

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
  settingsManager.applyOverrides(buildPiSettings(budget))

  const anyappSkills = await loadPiSkills(join(homedir(), '.anyapp', 'skills'))

  const mcpBindings = getMcpToolBindings(mcpSources)
  const mcpTools = createMcpTools({ bindings: mcpBindings, callTool: callbacks.callMcpTool })

  const loader = new DefaultResourceLoader({
    cwd: app.path,
    agentDir,
    settingsManager,
    systemPromptOverride: () => getSystemPrompt({ app, mcpTools: mcpBindings }),
    skillsOverride: (current) => ({
      skills: [...current.skills, ...anyappSkills],
      diagnostics: current.diagnostics
    }),
    extensionFactories: [
      createAnyappExtension({ rootPath: app.path, budget, trimEnabled, callbacks })
    ]
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
    tools: [
      ...resolveToolNames({ profile: toolProfile, contextWindow: budget.window }),
      ...mcpBindings.map((binding) => binding.qualifiedName)
    ],
    customTools: [
      ...createVersionTools(app.path),
      ...createWebTools({ rootPath: app.path, getAutoCommit: callbacks.getAutoCommit }),
      ...mcpTools
    ],
    resourceLoader: loader,
    sessionManager,
    settingsManager
  })

  const stall = createStallNotifier({ onStream: callbacks.onStream })

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    // Any event at all is proof the run is alive, so it resets the stall clock —
    // except `agent_start`, which is where the longest silence begins.
    if (event.type === 'agent_start') {
      stall.arm()
    } else if (event.type === 'agent_end' || event.type === 'agent_settled') {
      stall.clear()
    } else {
      stall.reset()
    }

    // Compaction replaces history with a summary, which is where a small model
    // loses the plan it was working to. The notes file survives it, so point at it.
    if (event.type === 'compaction_end' && !event.aborted && !event.errorMessage) {
      void session
        .sendCustomMessage(
          {
            customType: 'anyapp-compaction-notice',
            content: COMPACTION_NOTICE,
            display: false
          },
          { deliverAs: 'nextTurn' }
        )
        .catch(() => {
          // The nudge is an optimization; failing to queue it must not break the run.
        })
    }

    const chunk = toStreamChunk(event)
    if (!chunk) return

    // The end of a turn is the only moment context usage changes, so the meter rides
    // the chunk that already marks it rather than a polling channel of its own.
    callbacks.onStream(
      chunk.type === 'complete' ? { ...chunk, ...readContextUsage(session) } : chunk
    )
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
      stall.clear()
      unsubscribe()
      session.dispose()
    }
  }
}

/**
 * The live session type, re-exported for callers that hold one.
 */
export type { AgentSession }
