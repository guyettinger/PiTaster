/**
 * Pi agent session host.
 *
 * anyapp runs one Pi `AgentSession` per active sub-app. The session owns the agent
 * loop, the tools, the transcript, and the model connection; this module owns the
 * anyapp-specific parts bolted onto it — the permission gate, git auto-commit, the
 * version tools, and the system prompt.
 */

import { join, resolve } from 'node:path'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionAPI,
  type InlineExtension
} from '@earendil-works/pi-coding-agent'
import type {
  ConnectedSource,
  ContextReport,
  ContextUsage,
  ElementContext,
  PermissionMode,
  StreamChunk,
  SubApp
} from '@anyapp/core'
import { autoCommitToolResult } from './auto-commit'
import { createCodeTools, CODE_TOOL_NAMES } from './code-tools'
import { createDiagnosticsNotifier, type DiagnosticsNotifier } from './diagnostics-note'
import { createPatchRecorder } from './patch'
import { acquireTsService, type TsServiceLease } from './ts-service/registry'
import {
  deriveContextBudget,
  FALLBACK_CONTEXT_WINDOW,
  type ContextBudget
} from './context-budget'
import { confineContextFiles } from './context-files'
import { buildContextReport } from './context-report'
import { trimContext } from './context-trim'
import { createEditRepair } from './edit-repair'
import { createFileTools, FILE_TOOL_NAMES } from './file-tools'
import { createLoopGuard } from './loop-guard'
import { AnyappResourceLoader, buildPiSettings } from './pi-settings'
import { createRetryBudget, formatSilence } from './retry-budget'
import { createStallNotifier } from './stall-notifier'
import {
  createTelemetry,
  formatTurnSummary,
  readProviderResult,
  type Telemetry,
  type TelemetrySnapshot
} from './telemetry'
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
import { createSkillTools, SKILL_TOOL_NAMES } from './skill-tools'
import { loadSessionSkills } from './skills'
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
  ...FILE_TOOL_NAMES,
  ...CODE_TOOL_NAMES,
  ...VERSION_TOOL_NAMES,
  ...WEB_TOOL_NAMES,
  ...SKILL_TOOL_NAMES
]

/**
 * Pi's own built-in tool names, for selecting the guidance Pi writes for them.
 *
 * Kept separate from {@link AGENT_TOOL_NAMES} because only these seven have a
 * `promptGuidelines` contribution to recover — anyapp's custom tools carry their
 * guidance in their own descriptions.
 */
export const PI_BUILTIN_TOOL_NAMES = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls']

/**
 * Tools whose successful result carries the compiler's opinion of what they wrote.
 *
 * The set of tools that change a file through a `path` argument — which is deliberately
 * the same set `auto-commit.ts` commits, for the same reason. A file-modifying tool left
 * out of one of them either escapes version control or ships unchecked.
 *
 * `refactor` is absent because its edits are the compiler's own and it reports its own
 * file list; running diagnostics on the one file it was pointed at would describe a
 * fraction of what it changed.
 */
const DIAGNOSED_TOOLS = new Set(['write', 'edit', 'replace_lines'])

/**
 * Version tools dropped from the lean profile.
 *
 * Every tool costs context on every request — its name, description and JSON schema
 * ride in the function-calling payload — and a long list measurably worsens which
 * tool a small model picks. These four are the cheapest to lose: the agent rarely
 * needs them mid-task, and the user drives all of them from the Version Control
 * panel. `git_status` and `rollback` stay, because the agent does reach for those.
 *
 * `code_intel` and `refactor` are deliberately not here, though the same token argument
 * would seem to reach them. They are the two tools that earn their schema *most* on the
 * smallest window: on 32k a wasted `grep` and the two whole-file reads that follow it
 * cost a large fraction of the budget, and `code_intel` answers the same question in a
 * few lines. Dropping them to save two schemas would spend more than it saved.
 *
 * This only ever *removes* names from the allowlist. Nothing here changes what a tool
 * may do, or how `checkPermission` and `checkConfinement` classify it.
 */
const LEAN_PROFILE_OMITS = ['create_branch', 'switch_branch', 'list_branches', 'get_history']

/**
 * Window at or below which the lean tool profile is chosen automatically.
 *
 * Deliberately equal to {@link FALLBACK_CONTEXT_WINDOW}, and named through it so the
 * two cannot drift apart unnoticed. The comparison is `<=`, so every session that
 * falls back — the daemon unreachable, `/api/ps` silent, or only an advertised
 * maximum to go on — runs lean. That is the intent: a window anyapp had to guess at
 * is the last place to spend tokens on tool schemas the agent rarely reaches for.
 */
const LEAN_PROFILE_WINDOW = FALLBACK_CONTEXT_WINDOW

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
  /**
   * Settle any approval the user has not answered.
   *
   * Pi passes the run's `AbortSignal` as `beforeToolCall`'s second argument and
   * `AgentSession` drops it, so a `tool_call` handler awaiting approval never learns
   * the run was aborted. Every path that ends a run has to deny pending approvals
   * itself, which means anything in here that aborts needs this too.
   */
  denyPendingApprovals: () => void
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
  /**
   * Sampling temperature to pin, or null to leave the model's own default alone.
   *
   * Defaults to {@link DEFAULT_SAMPLING_TEMPERATURE}. See
   * {@link createSamplingExtension} for why anyapp sets this at all.
   */
  samplingTemperature?: number | null
  /** Existing Pi session file to resume, or undefined to start a new one. */
  sessionFile?: string
  /** Currently connected MCP sources, whose tools join this session. */
  mcpSources?: ConnectedSource[]
  /**
   * Where to record what each provider request cost.
   *
   * Defaults to a recorder of this host's own, which is right for a measurement of one
   * session and wrong for a measurement of one *conversation*: `disposeAgentHost` runs
   * on every skills, sources or config save, so a caller that wants the counts to
   * survive that has to own the recorder — the same reasoning that made `ipc.ts` cache
   * the last context report.
   */
  telemetry?: Telemetry
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
  /**
   * What the window is holding, attributed to blocks the user can act on.
   *
   * This replaced a `getContextUsage` that returned Pi's number alone. It carries that
   * same measured total, plus the fixed cost of the prompt, the tool schemas and the
   * skill manifest — none of which needs a session to compute. That fixed half is why
   * the meter can show a number before the first turn of a session, which the number
   * it replaced never could. See `agent/context-report.ts`.
   */
  getContextReport: () => Promise<ContextReport>
  /**
   * Summarize the conversation now, rather than waiting for the threshold.
   *
   * Pi emits its own `compaction_start` / `compaction_end` events, which `events.ts`
   * already maps to status chunks, so the UI narrates this without further wiring.
   */
  compact: () => Promise<void>
  /**
   * What the daemon has been asked to do, and what it cost.
   *
   * Prefill dominates a turn on a local model, and Ollama reports how much of each
   * prompt it had to prefill against how much it reused. See `agent/telemetry.ts`.
   */
  getTelemetry: () => TelemetrySnapshot
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
 * Temperature anyapp asks for unless the user says otherwise.
 *
 * Zero, because the task that dominates a coding session is reproducing text that
 * already exists — an `oldText` that has to match a file byte for byte, an import path,
 * a type name. Ollama takes its default from the model's Modelfile, which is 0.7 to 1.0
 * on the qwen builds anyapp targets, and at that setting a model that knows the right
 * indentation will still sometimes not emit it.
 */
export const DEFAULT_SAMPLING_TEMPERATURE = 0

/**
 * Bounds on that temperature, as the OpenAI-compatible endpoint defines them.
 *
 * Exported because the IPC validator and the Settings field both bound the user's
 * value, and a bound that disagrees with this one is accepted, persisted, shown back,
 * and then rejected by the daemon — the same reasoning as `MIN_CONTEXT_WINDOW`.
 */
export const MIN_SAMPLING_TEMPERATURE = 0
export const MAX_SAMPLING_TEMPERATURE = 2

/**
 * Build the inline extension that pins sampling on every provider request.
 *
 * Pi exposes no temperature: it is not in `models.json`, not in `SettingsManager`, and
 * not on `createAgentSession`. The `before_provider_request` hook is the only route —
 * its handler's return value *replaces* the request payload
 * (`dist/core/extensions/runner.js:834-836`, consumed by `sdk.js` `onPayload`), so
 * spreading a field onto it is how a host sets one.
 *
 * The payload is the provider's own request body, typed `unknown` by Pi because its
 * shape is provider-specific. anyapp only ever talks to Ollama's OpenAI-compatible
 * endpoint, where `temperature` is a documented top-level field, and the spread leaves
 * everything else untouched — so a payload shape Pi changes later still passes through
 * intact.
 *
 * @param temperature - The temperature to request
 * @returns A named inline extension
 */
function createSamplingExtension(temperature: number): InlineExtension {
  return {
    name: 'anyapp-sampling',
    factory: (pi: ExtensionAPI) => {
      pi.on('before_provider_request', async (event) => {
        if (typeof event.payload !== 'object' || event.payload === null) return undefined
        return { ...(event.payload as Record<string, unknown>), temperature }
      })
    }
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
  /** Reports the compiler errors a write introduced. */
  diagnostics: DiagnosticsNotifier
  /** Records what each provider request cost. */
  telemetry: Telemetry
  /** Application callbacks. */
  callbacks: AgentHostCallbacks
}): InlineExtension {
  const { rootPath, budget, trimEnabled, diagnostics, telemetry, callbacks } = params
  const loopGuard = createLoopGuard()
  const patches = createPatchRecorder({ rootPath })
  const editRepair = createEditRepair({
    rootPath,
    // The diagnostic quotes a region of the file back, so it is a tool result like any
    // other and gets the same per-result share of the window. A quarter of that is the
    // quote itself; the rest is Pi's own message and the instructions around it.
    maxQuoteTokens: Math.floor(budget.maxToolResultTokens / 4)
  })

  return {
    name: 'anyapp-guard',
    factory: (pi: ExtensionAPI) => {
      // The two ends of a provider request, and the only place anyapp can time one.
      //
      // Ollama sends no response headers until the first token, so the gap between
      // these two hooks is the prefill — the cost that dominates a turn on a local
      // model and the one the audit found anyapp paying twice over. Returning
      // `undefined` leaves the payload alone; the runner chains handlers and only
      // replaces the payload for a handler that returns one
      // (`extensions/runner.js:832-836`), so this coexists with the sampling
      // extension, which does replace it.
      pi.on('before_provider_request', async () => {
        telemetry.requestStarted()
        return undefined
      })

      pi.on('after_provider_response', async (event) => {
        telemetry.responseHeaders(event.status)
        return undefined
      })

      // A new user prompt always breaks a loop, so the streak starts over.
      //
      // Deliberately `agent_start`, not `turn_start`. Pi emits `turn_start` once per
      // inner-loop round — assistant response plus its tool calls — which is exactly
      // the granularity a stuck model repeats at, so resetting there would clear the
      // streak between every repetition and the guard could never fire.
      // `agent_start` fires once per submitted prompt — and once more for each retry
      // or overflow-compaction continuation, since `agentLoopContinue` re-emits it,
      // so a continuation does clear the streak mid-turn. That is accepted: the guard
      // exists to stop a model looping on its own output, and a continuation is Pi
      // restarting the turn rather than the model repeating itself.
      // `agent/retry-budget.ts` is what bounds the continuations.
      pi.on('agent_start', async () => {
        loopGuard.reset()
        // A new prompt is a new task; a streak of failed edits on the previous one says
        // nothing about this one.
        editRepair.reset()
        return undefined
      })

      // Shape what the model sees, never what is stored. The transcript, git history
      // and the chat UI keep the whole conversation regardless.
      if (trimEnabled) {
        pi.on('context', async (event) => ({
          messages: trimContext(event.messages, {
            maxToolResultTokens: budget.maxToolResultTokens,
            hardToolResultTokens: budget.hardToolResultTokens
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

        // The last thing before the write runs, so a blocked or denied call never
        // leaves a recording behind. Captured here rather than reconstructed from git
        // afterwards, so the diff appears whether or not auto-commit is on.
        if (DIAGNOSED_TOOLS.has(event.toolName) && typeof call.input.path === 'string') {
          await patches.record({ toolCallId: event.toolCallId, path: call.input.path })
        }

        return undefined
      })

      pi.on('tool_result', async (event) => {
        const input = event.input as Record<string, unknown>
        const path = input.path
        if (typeof path !== 'string') return undefined

        // Pi's edit failure names no line and quotes no text, and misdescribes its own
        // cause — so a small model retries the same mistake. Replacing the message with
        // the file's real text is what breaks that cycle. Runs before auto-commit
        // because a failed edit never commits anyway.
        if (event.toolName === 'edit') {
          const repair = await editRepair.repair({
            input,
            resultText: event.content
              .map((block) => (block.type === 'text' ? block.text : ''))
              .join('\n'),
            isError: event.isError === true
          })

          if (repair.text !== undefined) {
            return { content: [{ type: 'text' as const, text: repair.text }] }
          }
        }

        const outcome = await autoCommitToolResult({
          result: {
            toolName: event.toolName,
            input,
            isError: event.isError === true
          },
          rootPath,
          enabled: callbacks.getAutoCommit(),
          absolutePath: resolveLikePi(path, rootPath)
        })

        // What the compiler thinks of what was just written. Runs last, after the commit,
        // because a commit that failed is news about the *tool* and these errors are news
        // about the *code* — and because the file has to be on disk before the language
        // service can read it back.
        //
        // Only on success: reporting type errors for a write that never landed would have
        // the model chasing a file it did not change.
        const note =
          event.isError === true || !DIAGNOSED_TOOLS.has(event.toolName)
            ? null
            : await diagnostics.check(path)

        const patch = DIAGNOSED_TOOLS.has(event.toolName)
          ? event.isError === true
            ? (patches.forget(event.toolCallId), null)
            : await patches.complete({ toolCallId: event.toolCallId, path })
          : null

        const appended = [
          ...(outcome.note ? [{ type: 'text' as const, text: outcome.note }] : []),
          ...(note ? [{ type: 'text' as const, text: `\n${note}` }] : [])
        ]

        if (appended.length > 0 || patch) {
          return {
            content: appended.length > 0 ? [...event.content, ...appended] : event.content,
            // `details` is the one channel that reaches the UI without reaching the
            // model, which is what makes a diff in the transcript free.
            ...(patch ? { details: { ...(event.details as object), patches: [patch] } } : {})
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
    samplingTemperature = DEFAULT_SAMPLING_TEMPERATURE,
    sessionFile,
    mcpSources = [],
    telemetry = createTelemetry(),
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
  // Held as a function because every reload discards it and has to re-run it.
  const applyAnyappSettings = (): void => {
    settingsManager.applyOverrides(buildPiSettings(budget))
  }
  applyAnyappSettings()

  const skills = await loadSessionSkills(app)

  const mcpBindings = getMcpToolBindings(mcpSources)
  const mcpTools = createMcpTools({ bindings: mcpBindings, callTool: callbacks.callMcpTool })

  const toolNames = resolveToolNames({ profile: toolProfile, contextWindow: budget.window })

  // One language service per sub-app, shared with the code panel through the registry —
  // so the editor's squiggles and the errors appended to the agent's writes come from the
  // same program. Warmed here rather than on first use so the program build — seconds, on
  // a sub-app with React's declarations installed — happens while the user is still
  // typing, not inside the first edit.
  const tsService: TsServiceLease = acquireTsService(app.path)
  tsService.client.warm()
  const diagnostics = createDiagnosticsNotifier({
    source: { request: tsService.client.request }
  })

  const loader = new AnyappResourceLoader({
    cwd: app.path,
    agentDir,
    settingsManager,
    systemPromptOverride: () =>
      getSystemPrompt({
        app,
        skills,
        mcpTools: mcpBindings,
        toolNames: toolNames.filter((name) => PI_BUILTIN_TOOL_NAMES.includes(name))
      }),
    // Pi's own manifest is suppressed, not extended. It tells the model to open a
    // skill's `<location>` with `read`, and every path it would print is outside the
    // app root, where `checkConfinement` refuses it — so it advertised skills that
    // could never be loaded. `getSystemPrompt` renders anyapp's instead, naming
    // `load_skill`. Pi's diagnostics are kept; only its prompt section is dropped.
    skillsOverride: (current) => ({ skills: [], diagnostics: current.diagnostics }),
    agentsFilesOverride: confineContextFiles(app.path),
    extensionFactories: [
      createAnyappExtension({
        rootPath: app.path,
        budget,
        trimEnabled,
        diagnostics,
        telemetry,
        callbacks
      }),
      ...(samplingTemperature === null
        ? []
        : [createSamplingExtension(samplingTemperature)])
    ]
  }, applyAnyappSettings)

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
    tools: [...toolNames, ...mcpBindings.map((binding) => binding.qualifiedName)],
    customTools: [
      ...createFileTools({ rootPath: app.path }),
      ...createCodeTools({
        rootPath: app.path,
        request: tsService.client.request,
        getAutoCommit: callbacks.getAutoCommit
      }),
      ...createVersionTools(app.path),
      ...createWebTools({ rootPath: app.path, getAutoCommit: callbacks.getAutoCommit }),
      ...createSkillTools({ skills }),
      ...mcpTools
    ],
    resourceLoader: loader,
    sessionManager,
    settingsManager
  })

  const stall = createStallNotifier({ onStream: callbacks.onStream })
  const retryBudget = createRetryBudget()

  // Whether a turn is being measured.
  //
  // Deliberately not keyed on `agent_start` alone. Pi re-emits that for every retry
  // and every overflow-compaction continuation — the reason `loop-guard` resets there
  // and `retry-budget` deliberately does not — so a turn summary anchored to it would
  // start over mid-turn and report the last continuation as the whole turn.
  // `agent_settled` fires once, after everything that could continue the run has
  // declined to, which makes it the honest end.
  let turnOpen = false

  /**
   * Record one session event against the request being measured.
   *
   * Kept separate from the control flow below because nothing here decides anything:
   * it only writes down what the daemon did. The request's own two ends come from
   * Pi's provider hooks in the guard extension; everything else — the first token,
   * the final usage, the turn boundaries — is already passing through here.
   *
   * @param event - The Pi session event
   */
  const recordTelemetry = (event: AgentSessionEvent): void => {
    switch (event.type) {
      case 'agent_start':
        if (!turnOpen) {
          turnOpen = true
          telemetry.turnStarted()
        }
        return

      case 'compaction_start':
        telemetry.compactionStarted()
        return

      case 'message_update': {
        // Only the deltas. Pi's `done` and `error` events never reach `message_update`
        // — the loop calls `response.result()` and emits `message_end` instead — so a
        // request is closed there, not here.
        const inner = event.assistantMessageEvent
        if (inner.type === 'text_delta' || inner.type === 'thinking_delta') {
          telemetry.firstContent()
        }
        return
      }

      case 'message_end': {
        // `message_end` fires for user and tool-result messages too, and closing the
        // open request on one of those would record a turn's worth of prefill as
        // unmeasured. `readProviderResult` returns nothing for those.
        const result = readProviderResult(event.message)
        if (result) telemetry.messageFinished(result)
        return
      }

      case 'agent_settled': {
        turnOpen = false
        telemetry.turnEnded()
        const { turn, totals } = telemetry.snapshot()
        // One line per turn, and the only measurement anyapp produces until W4 gives
        // it a home in the UI. It is here rather than behind a flag because the
        // re-prefill count is the number whose absence hid Session 25's finding for
        // six sessions.
        if (turn.requests > 0) {
          console.log(
            '[agent]',
            formatTurnSummary(turn),
            `| session: ${totals.invalidations} invalidated, ${totals.compactions} compacted`
          )
        }
        return
      }

      default:
        return
    }
  }

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    recordTelemetry(event)

    // Any event at all is proof the run is alive, so it resets both clocks — except
    // `agent_start`, which is where the longest silence begins. A retry is not
    // progress, which is why `auto_retry_start` reaches neither reset: it arrives on
    // the failure path, and treating it as a sign of life would refresh the budget
    // exactly when it is supposed to be running out.
    if (event.type === 'agent_start') {
      stall.arm()
      retryBudget.start()
    } else if (event.type === 'agent_end' || event.type === 'agent_settled') {
      stall.clear()
      // `agent_end` also fires between retries, and the budget has to span those or
      // it measures one attempt instead of the silence.
      if (event.type === 'agent_settled' || !event.willRetry) retryBudget.clear()
    } else if (event.type !== 'auto_retry_start') {
      stall.reset()
      retryBudget.noteProgress()
    }

    // Pi cannot tell a hung request from a dropped socket — it matches on error text,
    // and "timed out" is in its retryable list. Retrying a request that produced no
    // bytes for the whole idle timeout only spends another one, so the turn is cut
    // here instead. Fast failures never reach the budget, and neither does a long
    // turn that is still producing: the budget measures silence, not elapsed time.
    if (event.type === 'auto_retry_start' && retryBudget.exhausted()) {
      callbacks.onStream({
        type: 'error',
        error:
          `The model has produced nothing for ${formatSilence(retryBudget.silentMs())}, ` +
          'and retrying is no longer helping. Check that Ollama is running and has ' +
          'room for this model, then try again.'
      })
      // Order matters, and matches `agent:abort`: deny first, so a `tool_call`
      // handler waiting on the user unblocks and Pi's loop can observe the abort.
      // Aborting alone would not reach it.
      callbacks.denyPendingApprovals()
      void session.abort()
      return
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

    getContextReport: () =>
      buildContextReport({
        app,
        budget,
        toolNames,
        builtinToolNames: PI_BUILTIN_TOOL_NAMES,
        mcpSources,
        messages: session.state.messages,
        measured: readContextUsage(session).contextUsage?.used ?? null
      }),

    compact: async () => {
      await session.compact()
    },

    getTelemetry: () => telemetry.snapshot(),

    dispose: () => {
      stall.clear()
      unsubscribe()
      tsService.release()
      session.dispose()
    }
  }
}

/**
 * The live session type, re-exported for callers that hold one.
 */
export type { AgentSession }
