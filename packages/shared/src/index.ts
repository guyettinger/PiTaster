/**
 * @anyapp/shared - Business logic for anyapp
 *
 * This package contains shared business logic including:
 * - Chat session storage over Pi transcripts
 * - Sources (MCP client, API handlers)
 * - Skills (loader and manager)
 * - Version control (isomorphic-git wrapper)
 */

export { VersionManager } from './versions/manager'
export type { CommitOptions, CreateBranchOptions, HistoryOptions } from './versions/manager'

// Sources
export { SourceManager } from './sources/manager'
export { McpClient } from './sources/mcp-client'

// Skills
export { SkillsLoader, extractSkillMentions, buildSystemPrompt } from './skills/loader'

// Apps
export { AppManager } from './apps/manager'
export { AppRunner } from './apps/runner'
export { getTemplate, getTemplates } from './apps/templates'

// Chat
export { ChatHistoryManager } from './chat/manager'
export { getAppPath, getAppSessionDir, getPiAgentDir } from './chat/session-paths'
