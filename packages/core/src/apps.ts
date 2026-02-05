/**
 * Sub-app template types for scaffolding new apps.
 */
export type AppTemplate =
  | 'react-vite'
  | 'node-cli'
  | 'node-server'
  | 'static-site'
  | 'blank'

/**
 * Sub-app status.
 */
export type AppStatus =
  | 'ready'
  | 'creating'
  | 'error'
  | 'building'

/**
 * Sub-app definition.
 */
export interface SubApp {
  /** Unique identifier (directory name). */
  id: string
  /** Display name. */
  name: string
  /** Brief description. */
  description: string
  /** Template used to create the app. */
  template: AppTemplate
  /** Current status. */
  status: AppStatus
  /** Absolute path to app directory. */
  path: string
  /** ISO timestamp when created. */
  createdAt: string
  /** ISO timestamp when last modified. */
  updatedAt: string
  /** Current git branch. */
  currentBranch?: string
  /** Whether app has uncommitted changes. */
  hasChanges?: boolean
}

/**
 * Parameters for creating a new sub-app.
 */
export interface CreateAppParams {
  /** Display name for the app. */
  name: string
  /** Brief description. */
  description?: string
  /** Template to use. */
  template: AppTemplate
}

/**
 * App context for scoped agent operations.
 */
export interface AppContext {
  /** The active sub-app, or null if no app selected. */
  activeApp: SubApp | null
  /** Root path for agent file operations. */
  rootPath: string
}

/**
 * Metadata stored in .anyapp-meta.json
 */
export interface AppMetadata {
  id: string
  name: string
  description: string
  template: AppTemplate
  status: AppStatus
  createdAt: string
  updatedAt: string
}

/**
 * Template file definition.
 */
export interface TemplateFile {
  /** Relative path within the app. */
  path: string
  /** File content (supports {{APP_NAME}}, {{APP_DESCRIPTION}}, {{APP_ID}} placeholders). */
  content: string
}

/**
 * Template definition for scaffolding.
 */
export interface AppTemplateConfig {
  /** Template identifier. */
  id: AppTemplate
  /** Display name. */
  name: string
  /** Description. */
  description: string
  /** Files to create. */
  files: TemplateFile[]
  /** Dependencies to install. */
  dependencies?: Record<string, string>
  /** Dev dependencies to install. */
  devDependencies?: Record<string, string>
  /** Scripts for package.json. */
  scripts?: Record<string, string>
}

/**
 * Running app state.
 */
export interface RunningApp {
  /** App ID that is running. */
  appId: string
  /** Process ID. */
  pid: number
  /** URL where the app is accessible, or null if not a web app. */
  url: string | null
  /** Port the app is running on. */
  port: number
  /** ISO timestamp when started. */
  startedAt: string
}

/**
 * App log entry.
 */
export interface AppLogEntry {
  /** App ID that produced this log. */
  appId: string
  /** ISO timestamp. */
  timestamp: string
  /** Log source type. */
  type: 'stdout' | 'stderr' | 'system'
  /** Log message content. */
  message: string
}

/**
 * Status change event for running apps.
 */
export interface AppStatusChange {
  /** App ID. */
  appId: string
  /** New status. */
  status: 'starting' | 'running' | 'stopped' | 'error'
  /** URL if running. */
  url?: string
  /** Port if running. */
  port?: number
  /** Error message if status is 'error'. */
  error?: string
}

/**
 * Port configuration for a template.
 */
export interface PortConfig {
  /** Starting port number. */
  base: number
  /** Maximum port number. */
  max: number
}

/**
 * Run configuration for a template.
 */
export interface AppRunConfig {
  /** Command to run (e.g., 'bun'). */
  command: string
  /** Base arguments (e.g., ['run', 'dev']). */
  args: string[]
  /** Port configuration. */
  ports: PortConfig
  /** How to pass port (cli flag or env var name). */
  portFlag: string | null
  /** Pattern to detect when server is ready. */
  readyPattern: RegExp | null
}
