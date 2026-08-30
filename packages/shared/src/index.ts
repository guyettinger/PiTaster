/**
 * @anyapp/shared - Business logic for anyapp
 *
 * This package contains shared business logic including:
 * - Chat session storage over Pi transcripts
 * - Sources (MCP client, API handlers)
 * - Skills (loader and manager)
 * - Version control (isomorphic-git wrapper)
 */

export { VersionManager } from './versions/manager.js'
export type { CommitOptions, CreateBranchOptions, HistoryOptions } from './versions/manager.js'

// Sources
export { SourceManager } from './sources/manager.js'
export { McpClient } from './sources/mcp-client.js'

// Skills
export { SkillsLoader, extractSkillMentions, buildSystemPrompt } from './skills/loader.js'

// Apps
export { AppManager } from './apps/manager.js'
export { AppRunner } from './apps/runner.js'
export { getTemplate, getTemplates } from './apps/templates.js'

// Chat
export { ChatHistoryManager } from './chat/manager.js'
export { getAppPath, getAppSessionDir, getPiAgentDir } from './chat/session-paths.js'

// Branding
export { dockIconSvg, LOGO_COLORS } from './branding/logo.js'
export type { DockIconOptions } from './branding/logo.js'
