# Session 4: Sources + Skills

## Overview

This session implements the sources system (MCP servers, REST APIs, filesystem) and the skills system (reusable agent instructions).

**Estimated scope**: Medium  
**Prerequisites**: Session 3 complete (version control working)  
**Deliverable**: Ability to connect external sources and use skills

## Objectives

1. Implement MCP client for stdio-based servers
2. Create source management types and storage
3. Implement skills loader and @mention system
4. Add source and skill management UIs
5. Create initial skill set

## Parallel Subagent Strategy

```
Main Agent (orchestrator)
├── Subagent A: MCP client implementation
├── Subagent B: Skills loader
└── Main Agent: UIs and integration
```

---

## Part 1: Source Types

### packages/core/src/sources.ts

```typescript
/**
 * Base source configuration.
 */
export interface SourceConfig {
  /** Unique source ID. */
  id: string
  /** Display name. */
  name: string
  /** Source type. */
  type: 'mcp' | 'api' | 'filesystem'
  /** Whether source is enabled. */
  enabled: boolean
  /** ISO timestamp when created. */
  createdAt: string
}

/**
 * MCP server source configuration.
 */
export interface McpSourceConfig extends SourceConfig {
  type: 'mcp'
  /** Command to run (e.g., 'npx'). */
  command: string
  /** Command arguments. */
  args: string[]
  /** Environment variables to pass. */
  env?: Record<string, string>
}

/**
 * REST API source configuration.
 */
export interface ApiSourceConfig extends SourceConfig {
  type: 'api'
  /** Base URL. */
  baseUrl: string
  /** Authentication type. */
  authType: 'none' | 'apiKey' | 'oauth'
  /** API key (if authType is 'apiKey'). */
  apiKey?: string
  /** OAuth config (if authType is 'oauth'). */
  oauth?: {
    clientId: string
    authUrl: string
    tokenUrl: string
    scopes: string[]
  }
}

/**
 * Filesystem source configuration.
 */
export interface FilesystemSourceConfig extends SourceConfig {
  type: 'filesystem'
  /** Root path to expose. */
  rootPath: string
  /** Glob patterns to include. */
  include?: string[]
  /** Glob patterns to exclude. */
  exclude?: string[]
}

/**
 * Union of all source types.
 */
export type AnySourceConfig = McpSourceConfig | ApiSourceConfig | FilesystemSourceConfig

/**
 * MCP tool definition from a source.
 */
export interface McpTool {
  /** Tool name. */
  name: string
  /** Tool description. */
  description: string
  /** JSON schema for input. */
  inputSchema: Record<string, unknown>
}

/**
 * Connected source state.
 */
export interface ConnectedSource {
  /** Source configuration. */
  config: AnySourceConfig
  /** Whether currently connected. */
  connected: boolean
  /** Available tools (for MCP sources). */
  tools?: McpTool[]
  /** Error message if connection failed. */
  error?: string
}
```

### Update packages/core/src/index.ts

```typescript
export * from './agent'
export * from './permissions'
export * from './messages'
export * from './versions'
export * from './sources'
export * from './skills'  // Add next
```

---

## Part 2: MCP Client (Subagent A)

### packages/shared/src/sources/mcp-client.ts

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpSourceConfig, McpTool } from '@pitaster/core'

// Environment variables to filter out when spawning
const BLOCKED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'GITHUB_TOKEN',
  'GH_TOKEN'
]

export class McpClient {
  private client: Client | null = null
  private transport: StdioClientTransport | null = null
  
  constructor(private config: McpSourceConfig) {}
  
  /**
   * Connect to the MCP server.
   */
  async connect(): Promise<McpTool[]> {
    // Filter environment
    const filteredEnv = Object.fromEntries(
      Object.entries(process.env)
        .filter(([key]) => !BLOCKED_ENV_VARS.includes(key))
    )
    
    // Merge with source-specific env
    const env = { ...filteredEnv, ...this.config.env }
    
    // Create client
    this.client = new Client({
      name: `pitaster-${this.config.id}`,
      version: '1.0.0'
    })
    
    // Create transport
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env
    })
    
    // Connect
    await this.client.connect(this.transport)
    
    // List available tools
    const tools = await this.listTools()
    return tools
  }
  
  /**
   * List available tools from the server.
   */
  async listTools(): Promise<McpTool[]> {
    if (!this.client) throw new Error('Not connected')
    
    const result = await this.client.listTools()
    return result.tools.map(t => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema as Record<string, unknown>
    }))
  }
  
  /**
   * Call a tool on the server.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error('Not connected')
    
    const result = await this.client.callTool({ name, arguments: args })
    return result
  }
  
  /**
   * Disconnect from the server.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
      this.transport = null
    }
  }
  
  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.client !== null
  }
}
```

### packages/shared/src/sources/manager.ts

```typescript
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AnySourceConfig, ConnectedSource } from '@pitaster/core'
import { McpClient } from './mcp-client'

export class SourceManager {
  private sources = new Map<string, ConnectedSource>()
  private mcpClients = new Map<string, McpClient>()
  
  constructor(private configDir: string) {}
  
  /**
   * Load all source configurations.
   */
  async loadSources(): Promise<AnySourceConfig[]> {
    const sourcesDir = join(this.configDir, 'sources')
    
    try {
      const files = await fs.readdir(sourcesDir)
      const configs: AnySourceConfig[] = []
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(join(sourcesDir, file), 'utf-8')
          configs.push(JSON.parse(content))
        }
      }
      
      return configs
    } catch {
      return []
    }
  }
  
  /**
   * Save a source configuration.
   */
  async saveSource(config: AnySourceConfig): Promise<void> {
    const sourcesDir = join(this.configDir, 'sources')
    await fs.mkdir(sourcesDir, { recursive: true })
    
    const filepath = join(sourcesDir, `${config.id}.json`)
    await fs.writeFile(filepath, JSON.stringify(config, null, 2))
  }
  
  /**
   * Connect to a source.
   */
  async connect(config: AnySourceConfig): Promise<ConnectedSource> {
    if (config.type === 'mcp') {
      const client = new McpClient(config)
      
      try {
        const tools = await client.connect()
        this.mcpClients.set(config.id, client)
        
        const connected: ConnectedSource = {
          config,
          connected: true,
          tools
        }
        this.sources.set(config.id, connected)
        return connected
      } catch (error: any) {
        const failed: ConnectedSource = {
          config,
          connected: false,
          error: error.message
        }
        this.sources.set(config.id, failed)
        return failed
      }
    }
    
    // TODO: Handle API and filesystem sources
    throw new Error(`Source type ${config.type} not yet implemented`)
  }
  
  /**
   * Disconnect from a source.
   */
  async disconnect(sourceId: string): Promise<void> {
    const client = this.mcpClients.get(sourceId)
    if (client) {
      await client.disconnect()
      this.mcpClients.delete(sourceId)
    }
    
    const source = this.sources.get(sourceId)
    if (source) {
      source.connected = false
      this.sources.set(sourceId, source)
    }
  }
  
  /**
   * Call a tool on a source.
   */
  async callTool(sourceId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const client = this.mcpClients.get(sourceId)
    if (!client) throw new Error(`Source ${sourceId} not connected`)
    
    return client.callTool(toolName, args)
  }
  
  /**
   * Get all connected sources.
   */
  getConnectedSources(): ConnectedSource[] {
    return Array.from(this.sources.values())
  }
}
```

---

## Part 3: Skills System (Subagent B)

### packages/core/src/skills.ts

```typescript
/**
 * A skill definition.
 */
export interface Skill {
  /** Skill name (kebab-case). */
  name: string
  /** Short description. */
  description: string
  /** Full instruction content. */
  content: string
  /** File path where skill is stored. */
  filepath: string
}

/**
 * Skill mention in a message.
 */
export interface SkillMention {
  /** The mentioned skill name. */
  name: string
  /** Start index in message. */
  start: number
  /** End index in message. */
  end: number
}
```

### packages/shared/src/skills/loader.ts

```typescript
import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'
import type { Skill } from '@pitaster/core'

/**
 * Parse skill frontmatter from content.
 */
function parseSkillFrontmatter(content: string): { name: string; description: string; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  
  if (!match) {
    return { name: '', description: '', body: content }
  }
  
  const frontmatter = match[1]
  const body = match[2]
  
  const nameMatch = frontmatter.match(/name:\s*(.+)/)
  const descMatch = frontmatter.match(/description:\s*(.+)/)
  
  return {
    name: nameMatch?.[1]?.trim() ?? '',
    description: descMatch?.[1]?.trim() ?? '',
    body: body.trim()
  }
}

export class SkillsLoader {
  constructor(private skillsDir: string) {}
  
  /**
   * Load all skills from the skills directory.
   */
  async loadAll(): Promise<Skill[]> {
    const skills: Skill[] = []
    
    try {
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true })
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = join(this.skillsDir, entry.name, 'SKILL.md')
          try {
            const content = await fs.readFile(skillPath, 'utf-8')
            const parsed = parseSkillFrontmatter(content)
            
            skills.push({
              name: parsed.name || entry.name,
              description: parsed.description,
              content: parsed.body,
              filepath: skillPath
            })
          } catch {
            // Skill doesn't have SKILL.md, skip
          }
        }
      }
    } catch {
      // Skills directory doesn't exist
    }
    
    return skills
  }
  
  /**
   * Load a specific skill by name.
   */
  async load(name: string): Promise<Skill | null> {
    const skillPath = join(this.skillsDir, name, 'SKILL.md')
    
    try {
      const content = await fs.readFile(skillPath, 'utf-8')
      const parsed = parseSkillFrontmatter(content)
      
      return {
        name: parsed.name || name,
        description: parsed.description,
        content: parsed.body,
        filepath: skillPath
      }
    } catch {
      return null
    }
  }
  
  /**
   * Save a skill.
   */
  async save(skill: Skill): Promise<void> {
    const skillDir = join(this.skillsDir, skill.name)
    await fs.mkdir(skillDir, { recursive: true })
    
    const content = `---
name: ${skill.name}
description: ${skill.description}
---

${skill.content}`
    
    await fs.writeFile(join(skillDir, 'SKILL.md'), content)
  }
  
  /**
   * Delete a skill.
   */
  async delete(name: string): Promise<void> {
    const skillDir = join(this.skillsDir, name)
    await fs.rm(skillDir, { recursive: true })
  }
}

/**
 * Extract @mentions from a message.
 */
export function extractSkillMentions(message: string): { name: string; start: number; end: number }[] {
  const mentions: { name: string; start: number; end: number }[] = []
  const regex = /@([a-z0-9-]+)/g
  
  let match
  while ((match = regex.exec(message)) !== null) {
    mentions.push({
      name: match[1],
      start: match.index,
      end: match.index + match[0].length
    })
  }
  
  return mentions
}

/**
 * Build system prompt with skill content.
 */
export function buildSystemPrompt(basePrompt: string, skills: Skill[]): string {
  if (skills.length === 0) return basePrompt
  
  const skillsSection = skills.map(s => 
    `## Skill: ${s.name}\n\n${s.content}`
  ).join('\n\n---\n\n')
  
  return `${basePrompt}

---

# Active Skills

${skillsSection}`
}
```

### Update packages/shared/src/index.ts

```typescript
export { VersionManager } from './versions/manager'
export { SourceManager } from './sources/manager'
export { McpClient } from './sources/mcp-client'
export { SkillsLoader, extractSkillMentions, buildSystemPrompt } from './skills/loader'
```

---

## Part 4: Update Dependencies

### apps/electron/package.json

Add MCP SDK:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.25.0",
    // ... existing
  }
}
```

---

## Part 5: Skills UI (Main Agent)

### apps/electron/src/renderer/src/components/SkillsPanel.tsx

```tsx
import { useState, useEffect } from 'react'
import type { Skill } from '@pitaster/core'

interface SkillsPanelProps {
  onSkillSelect: (skill: Skill) => void
}

export function SkillsPanel({ onSkillSelect }: SkillsPanelProps) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [search, setSearch] = useState('')
  
  useEffect(() => {
    loadSkills()
  }, [])
  
  const loadSkills = async () => {
    const loaded = await window.electronAPI.getSkills()
    setSkills(loaded)
  }
  
  const filtered = skills.filter(s => 
    s.name.includes(search) || s.description.includes(search)
  )
  
  return (
    <div className="flex flex-col h-full border-l bg-white">
      <div className="p-3 border-b">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills..."
          className="w-full px-2 py-1.5 border rounded text-sm"
        />
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {filtered.map(skill => (
          <button
            key={skill.name}
            onClick={() => onSkillSelect(skill)}
            className="w-full text-left p-3 border-b hover:bg-neutral-50"
          >
            <div className="font-medium text-sm">@{skill.name}</div>
            <div className="text-xs text-neutral-500 mt-0.5 truncate">
              {skill.description}
            </div>
          </button>
        ))}
        
        {filtered.length === 0 && (
          <div className="p-4 text-center text-neutral-500 text-sm">
            No skills found
          </div>
        )}
      </div>
    </div>
  )
}
```

### apps/electron/src/renderer/src/components/SourcesPanel.tsx

```tsx
import { useState, useEffect } from 'react'
import type { ConnectedSource, McpSourceConfig } from '@pitaster/core'

export function SourcesPanel() {
  const [sources, setSources] = useState<ConnectedSource[]>([])
  const [isAdding, setIsAdding] = useState(false)
  
  useEffect(() => {
    loadSources()
  }, [])
  
  const loadSources = async () => {
    const loaded = await window.electronAPI.getSources()
    setSources(loaded)
  }
  
  const connectSource = async (id: string) => {
    await window.electronAPI.connectSource(id)
    loadSources()
  }
  
  const disconnectSource = async (id: string) => {
    await window.electronAPI.disconnectSource(id)
    loadSources()
  }
  
  return (
    <div className="flex flex-col h-full border-l bg-white">
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="font-medium">Sources</h3>
        <button 
          onClick={() => setIsAdding(true)}
          className="text-sm text-blue-500 hover:underline"
        >
          + Add
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {sources.map(source => (
          <div 
            key={source.config.id}
            className="p-3 border-b"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">{source.config.name}</div>
                <div className="text-xs text-neutral-500">{source.config.type}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${source.connected ? 'bg-green-500' : 'bg-neutral-300'}`} />
                <button
                  onClick={() => source.connected 
                    ? disconnectSource(source.config.id)
                    : connectSource(source.config.id)
                  }
                  className="text-xs text-blue-500 hover:underline"
                >
                  {source.connected ? 'Disconnect' : 'Connect'}
                </button>
              </div>
            </div>
            
            {source.error && (
              <div className="mt-1 text-xs text-red-500">{source.error}</div>
            )}
            
            {source.tools && source.tools.length > 0 && (
              <div className="mt-2 text-xs text-neutral-500">
                {source.tools.length} tools available
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## Part 6: IPC Handlers

### Add to apps/electron/src/main/ipc.ts

```typescript
import { SourceManager } from '@pitaster/shared'
import { SkillsLoader } from '@pitaster/shared'
import { homedir } from 'node:os'
import { join } from 'node:path'

const configDir = join(homedir(), '.Pi Taster')
const sourceManager = new SourceManager(configDir)
const skillsLoader = new SkillsLoader(join(configDir, 'skills'))

// Sources IPC
ipcMain.handle('sources:list', () => sourceManager.getConnectedSources())
ipcMain.handle('sources:connect', async (_, id: string) => {
  const configs = await sourceManager.loadSources()
  const config = configs.find(c => c.id === id)
  if (config) {
    return sourceManager.connect(config)
  }
})
ipcMain.handle('sources:disconnect', (_, id: string) => sourceManager.disconnect(id))

// Skills IPC
ipcMain.handle('skills:list', () => skillsLoader.loadAll())
ipcMain.handle('skills:get', (_, name: string) => skillsLoader.load(name))
ipcMain.handle('skills:save', (_, skill: Skill) => skillsLoader.save(skill))
ipcMain.handle('skills:delete', (_, name: string) => skillsLoader.delete(name))
```

### Add to preload

```typescript
// Sources
getSources: () => ipcRenderer.invoke('sources:list'),
connectSource: (id: string) => ipcRenderer.invoke('sources:connect', id),
disconnectSource: (id: string) => ipcRenderer.invoke('sources:disconnect', id),

// Skills
getSkills: () => ipcRenderer.invoke('skills:list'),
getSkill: (name: string) => ipcRenderer.invoke('skills:get', name),
saveSkill: (skill: Skill) => ipcRenderer.invoke('skills:save', skill),
deleteSkill: (name: string) => ipcRenderer.invoke('skills:delete', name),
```

---

## Part 7: Create Initial Skills

Create these skills in `~/.pitaster/skills/`:

### self-modify/SKILL.md

```markdown
---
name: self-modify
description: Modify the Pi Taster app's own source code safely. Use when the user wants to change app behavior, add features, or fix bugs.
---

# Self-Modification

When modifying Pi Taster's source code:

1. Read the current file before modifying
2. Make incremental changes, not wholesale rewrites
3. Preserve existing imports and type safety
4. Run typecheck after changes
5. If build fails, analyze and fix or rollback
6. Notify user before restarting

## Safety

- All changes are auto-committed to git
- Use version_history to see recent changes
- Use version_rollback to undo mistakes
- Create a branch for risky experiments
```

### debug-fix/SKILL.md

```markdown
---
name: debug-fix
description: Debug issues and fix bugs in Pi Taster. Use when user reports errors or unexpected behavior.
---

# Debugging

1. Check error stack traces carefully
2. Identify affected module (main/preload/renderer/shared)
3. Check IPC communication if cross-process issue
4. Verify permission mode if tool execution fails
5. Create minimal reproduction before fixing
6. Test fix thoroughly
```

### manage-versions/SKILL.md

```markdown
---
name: manage-versions
description: Manage version control for modifications. Use when user wants to create branches, rollback, or experiment safely.
---

# Version Management

## Safe Experimentation
1. version_create_branch for new experiments
2. Make changes on the branch
3. Test thoroughly
4. version_merge if successful, or switch back to main

## Quick Rollback
1. version_history to see recent commits
2. version_rollback to restore previous state

## Commands
- version_status - check current state
- version_list_branches - see all branches
- version_create_branch - new experiment branch
- version_switch_branch - change branches
- version_rollback - restore to commit
- version_merge - merge branch
```

---

## Verification Checklist

- [ ] MCP client connects to stdio servers
- [ ] Source configurations save/load correctly
- [ ] Skills load from directory
- [ ] @mentions extracted from messages
- [ ] Sources panel shows connected/disconnected state
- [ ] Skills panel searchable
- [ ] Initial skills created

## Commit Checkpoint

```bash
git add -A
git commit -m "feat: sources and skills system

- Add MCP client for stdio-based servers
- Implement SourceManager for source lifecycle
- Add SkillsLoader with frontmatter parsing
- Add @mention extraction for skill references
- Create Sources and Skills UI panels
- Add initial skills (self-modify, debug-fix, manage-versions)"
```

---

## Next Session

Proceed to **SESSION-5-POLISH.md** for final integration and polish.
