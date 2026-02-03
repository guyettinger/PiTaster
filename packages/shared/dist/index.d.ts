/**
 * @clirabbit/shared - Business logic for CLIRabbit
 *
 * This package contains shared business logic including:
 * - Agent wrapper (Claude Agent SDK)
 * - Sources (MCP client, API handlers)
 * - Skills (loader and manager)
 * - Permissions (CanUseTool implementation)
 * - Version control (isomorphic-git wrapper)
 */
export { VersionManager } from './versions/manager';
export type { CommitOptions, CreateBranchOptions, HistoryOptions } from './versions/manager';
export { SourceManager } from './sources/manager';
export { McpClient } from './sources/mcp-client';
export { SkillsLoader, extractSkillMentions, buildSystemPrompt } from './skills/loader';
//# sourceMappingURL=index.d.ts.map