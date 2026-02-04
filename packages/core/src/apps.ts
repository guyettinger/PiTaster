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
