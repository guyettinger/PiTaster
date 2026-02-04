/**
 * @anyapp/shared - Business logic for anyapp
 *
 * This package contains shared business logic including:
 * - Agent wrapper (Claude Agent SDK)
 * - Sources (MCP client, API handlers)
 * - Skills (loader and manager)
 * - Permissions (CanUseTool implementation)
 * - Version control (isomorphic-git wrapper)
 */
export { VersionManager } from './versions/manager';
// Sources
export { SourceManager } from './sources/manager';
export { McpClient } from './sources/mcp-client';
// Skills
export { SkillsLoader, extractSkillMentions, buildSystemPrompt } from './skills/loader';
