/**
 * Seed bodies anyapp has since corrected.
 *
 * `seedSkills` never overwrites, which is right for a file the user may have edited and
 * wrong for one anyapp shipped with a defect. Every skill below was seeded with content
 * that was untrue of this agent — `manage-versions` documented nine `version_*` tools
 * that do not exist, `enhance-ui` told the model to import from a component library the
 * app has never contained, and `self-modify` and `connect-source` described work the
 * confined agent cannot do at all. Left alone, every existing install keeps them.
 *
 * A body is replaced only when it still matches one of these **exactly**. Anything the
 * user has touched is left where it is and flagged in the Skills panel instead, because
 * a migration that overwrites someone's edits is worse than the defect it fixes.
 *
 * **The bodies below still say `anyapp` and `Pi Taster`, and that is deliberate — do not
 * rebrand them.**
 * They are not documentation. They are equality keys against text sitting on users'
 * disks, written under each of the app's earlier names. Changing one character makes
 * the comparison above answer "the user edited this" for a file the user never touched,
 * and the defective seed is then kept forever — silently, and for exactly the installs
 * this list exists to repair. New seed content lives in `docs/skills/`; this file is a
 * record of what was already shipped, so it is append-only.
 *
 * Maintained by hand, unlike `seed-content.ts` — `scripts/generate-seed-content.ts`
 * writes that file and never this one. Append here whenever a body in `docs/skills/`
 * changes, using the *previous* text: a seed edited without an entry here is a
 * correction that reaches no existing install, which is how every install still
 * carries `create-skill` telling the agent about `~/.anyapp/skills`.
 */

/**
 * One superseded seed.
 */
export interface SupersededSeed {
  /** The skill's directory name. */
  name: string
  /** The exact body anyapp shipped, trimmed the way the loader trims it. */
  body: string
  /** True when the corrected answer is to remove the skill rather than rewrite it. */
  removed: boolean
}

/**
 * Bodies that may be replaced or removed on upgrade.
 */
export const SUPERSEDED_SEEDS: SupersededSeed[] = [
  {
    name: "connect-source",
    removed: true,
    body: `# Connecting Sources

Use this skill when you need to connect Anyapp to external data sources.

## MCP Servers

To connect an MCP server:

1. Identify the server command (e.g., \`npx -y @modelcontextprotocol/server-github\`)
2. Create source configuration with:
   - \`type: 'mcp'\`
   - \`command\`: the server command
   - \`args\`: command arguments array
   - \`env\`: optional environment variables
3. Connect using the Sources panel or programmatically
4. List available tools from the connected server

### Example MCP Configuration

\`\`\`json
{
  "id": "github-server",
  "name": "GitHub MCP",
  "type": "mcp",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_TOKEN": "..."
  }
}
\`\`\`

## REST APIs

For REST API sources:

1. Get the base URL for the API
2. Determine authentication type:
   - API key (header or query param)
   - OAuth 2.0
   - Basic auth
3. Configure credentials securely
4. Test the connection with a simple request

## Local Filesystem

For filesystem access:

1. Specify the root path to watch
2. Set include patterns (e.g., \`["**/*.ts", "**/*.tsx"]\`)
3. Set exclude patterns (e.g., \`["node_modules/**", "dist/**"]\`)
4. Test file listing works correctly

## Best Practices

- Always test connections before relying on them
- Store sensitive credentials in the config file, not in code
- Use environment variables for secrets when possible
- Disconnect sources when not in use to free resources`
  },
  {
    name: "create-skill",
    removed: false,
    body: `# Creating Skills

Use this skill to create new skills for Anyapp.

## Skill Structure

Skills are stored in \`~/.anyapp/skills/{name}/SKILL.md\`

\`\`\`
~/.anyapp/skills/
├── my-skill/
│   └── SKILL.md
├── another-skill/
│   └── SKILL.md
\`\`\`

## SKILL.md Format

\`\`\`markdown
---
name: skill-name
description: Brief description for when to use this skill.
---

# Skill Title

Instructions for the agent when this skill is activated...
\`\`\`

### Frontmatter Fields

- \`name\`: Kebab-case identifier (must match folder name)
- \`description\`: 1-2 sentence description with trigger words

## Best Practices

### Description Writing

- Include specific trigger words users might say
- Be concise but descriptive
- Examples:
  - Good: "Create React components with TypeScript and shadcn/ui"
  - Bad: "Help with UI"

### Content Writing

- Start with a clear purpose statement
- Include concrete examples and code snippets
- Use markdown formatting for structure
- Keep under 500 lines for context efficiency
- Reference specific files/paths when relevant

### Naming

- Use kebab-case for skill names
- Choose descriptive, action-oriented names
- Examples: \`create-component\`, \`debug-error\`, \`optimize-performance\`

## Using Skills

Users activate skills by mentioning them with \`@\`:

\`\`\`
@create-skill Create a new skill for database migrations
\`\`\`

Multiple skills can be combined:

\`\`\`
@enhance-ui @create-component Add a new settings dialog
\`\`\`

## Example Skill

\`\`\`markdown
---
name: add-test
description: Write tests for React components using Vitest and Testing Library.
---

# Writing Tests

## Test File Location

Place tests next to the component:

- \`components/Button.tsx\`
- \`components/Button.test.tsx\`

## Test Structure

\\\`\\\`\\\`typescript
import { render, screen } from '@testing-library/react'
import { Button } from './Button'

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })
})
\\\`\\\`\\\`
\`\`\``
  },
  {
    name: "debug-fix",
    removed: false,
    body: `# Debugging

## Diagnostic Steps

1. Check error stack traces carefully
2. Identify affected module (main/preload/renderer/shared)
3. Check IPC communication if cross-process issue
4. Verify permission mode if tool execution fails
5. Create minimal reproduction before fixing
6. Test fix thoroughly

## Common Issues

### IPC Errors
- Check handler exists in \`ipc.ts\`
- Verify preload exposes the method
- Check argument types match

### Type Errors
- Run \`bun run typecheck:all\`
- Check imports from @anyapp/core
- Verify workspace dependencies

### Runtime Errors
- Check Electron console (main process)
- Check DevTools console (renderer)
- Look for async/await issues

## Debug Commands

\`\`\`bash
# Type check entire monorepo
bun run typecheck:all

# Build packages
bun run build

# Check specific package
bun run --filter @anyapp/shared typecheck
\`\`\`

## Rollback

If a fix introduces more issues:
1. Use version_history to find last good commit
2. Use version_rollback to restore
3. Analyze what went wrong before retrying`
  },
  {
    name: "enhance-ui",
    removed: false,
    body: `# UI Enhancement Guidelines

Use this skill when improving the Anyapp user interface.

## Component Library

Anyapp uses shadcn/ui components. Import from:

\`\`\`typescript
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
\`\`\`

## Styling Guidelines

### Tailwind CSS

- Use utility classes directly in components
- Follow mobile-first responsive design
- Use the neutral color palette for dark mode consistency
- Common patterns:
  - \`bg-neutral-950\` - main background
  - \`bg-neutral-900\` - card/panel background
  - \`bg-neutral-800\` - input/elevated surface
  - \`text-neutral-50\` - primary text
  - \`text-neutral-400\` - secondary text
  - \`border-neutral-700/800\` - borders

### Dark Mode

The app uses a dark theme by default. Ensure:

- Sufficient contrast for text readability
- Consistent use of the neutral color scale
- Hover/focus states are visible

## Adding New Components

1. Check if a shadcn/ui component exists first
2. Read existing similar components for patterns
3. Follow the existing file naming convention (kebab-case)
4. Use named exports, not default exports
5. Add TypeScript interfaces with TSDoc comments

## State Management

- Use React hooks for local state
- Use IPC for data from main process
- Consider React Query for caching server state

## Testing Changes

1. Run \`bun run dev\` to start hot reload
2. Test in the Electron window
3. Check responsive behavior
4. Verify dark mode consistency
5. Run \`bun run typecheck:all\` before committing`
  },
  {
    name: "manage-versions",
    removed: false,
    body: `# Version Management

## Safe Experimentation

1. version_create_branch for new experiments
2. Make changes on the branch
3. Test thoroughly
4. version_merge if successful, or switch back to main

## Quick Rollback

1. version_history to see recent commits
2. version_rollback to restore previous state

## Version Control Tools

### Status
- \`version_status\` - Check current state (branch, HEAD, uncommitted changes)

### Branches
- \`version_list_branches\` - See all branches
- \`version_create_branch\` - Create new experiment branch
- \`version_switch_branch\` - Change to different branch

### History
- \`version_history\` - List recent commits
- \`version_rollback\` - Restore to a specific commit

### Merging
- \`version_merge\` - Merge a branch into current

## Workflow Examples

### Risky Change
\`\`\`
1. version_create_branch("experiment-feature")
2. Make changes
3. Test
4. If good: version_merge("experiment-feature")
5. If bad: version_switch_branch("main")
\`\`\`

### Quick Fix
\`\`\`
1. Make fix directly on main
2. Changes auto-commit
3. If broken: version_rollback to previous commit
\`\`\`

### Compare Changes
\`\`\`
1. version_history to find commit SHAs
2. version_diff(from, to) to see what changed
\`\`\``
  },
  {
    name: "self-modify",
    removed: true,
    body: `# Self-Modification

When modifying Anyapp's source code:

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

## Architecture

- \`apps/electron/\` - Electron desktop app
  - \`src/main/\` - Main process (Node.js)
  - \`src/preload/\` - Context bridge
  - \`src/renderer/\` - React UI
- \`packages/core/\` - Shared TypeScript types
- \`packages/shared/\` - Business logic

## Best Practices

- Follow existing patterns in the codebase
- Use TSDoc comments for documentation
- Maintain type safety - avoid \`any\`
- Test changes before committing`
  },
  {
    name: "create-skill",
    removed: false,
    body: `# Writing a Skill

A skill is a folder with a \`SKILL.md\` in it. Write one when you have worked out how to
do something in *this* app that you would otherwise work out again from scratch.

## Where It Goes

\`\`\`
skills/<name>/SKILL.md
\`\`\`

In the app root — the same place as \`package.json\`. That is inside the directory you
can write to, and it is committed with the app, so the skill is versioned alongside the
code it describes.

Do not try to write to \`~/.anyapp/skills\`. That is the user's own library, shared by
every app, and it is outside your reach.

## The File

\`\`\`markdown
---
name: add-endpoint
description: Add a REST endpoint to this app's Hono server, wired to a handler and a type. Use when adding a new route.
---

# Add an Endpoint

...the steps...
\`\`\`

Two frontmatter fields, both required:

- **\`name\`** — lowercase letters, numbers and hyphens. It must match the folder name.
- **\`description\`** — **one line.** A second line is silently discarded.

## The Description Is the Whole Trigger

It is the only part of a skill anyone sees before deciding to open it — it sits in
every request, and it is what a later session matches the task against. The body costs
nothing until it is loaded.

So write the description as *when to use this*, not *what this is*:

- Good: "Add a pony behavior, building, or shop item. Use when extending the reducer or
  gameData."
- Bad: "Game system helper."

Name the concrete things a request would mention — files, features, the words the user
would actually say.

## The Body

- **Be specific to this app.** Real paths, real function names, real commands read from
  \`package.json\`. A skill that could apply to any project is not worth loading.
- **Write the steps in order**, the way you just did them.
- **Say what not to do**, if you hit something that did not work. That is the part
  worth keeping.
- **Keep it under a couple of hundred lines.** It is read into a small context window.

## After Writing It

Say the name out loud to the user — a skill nobody knows exists is not much use. It is
available immediately; call \`load_skill\` with its name when the task comes round again.`
  },
  {
    name: "create-skill",
    removed: false,
    body: `# Writing a Skill

A skill is a folder with a \`SKILL.md\` in it. Write one when you have worked out how to
do something in *this* app that you would otherwise work out again from scratch.

## Where It Goes

\`\`\`
skills/<name>/SKILL.md
\`\`\`

In the app root — the same place as \`package.json\`. That is inside the directory you
can write to, and it is committed with the app, so the skill is versioned alongside the
code it describes.

Do not try to write to \`~/.pitaster/skills\`. That is the user's own library, shared by
every app, and it is outside your reach.

## The File

\`\`\`markdown
---
name: add-endpoint
description: Add a REST endpoint to this app's Hono server, wired to a handler and a type. Use when adding a new route.
---

# Add an Endpoint

...the steps...
\`\`\`

Two frontmatter fields, both required:

- **\`name\`** — lowercase letters, numbers and hyphens. It must match the folder name.
- **\`description\`** — **one line.** A second line is silently discarded.

## The Description Is the Whole Trigger

It is the only part of a skill anyone sees before deciding to open it — it sits in
every request, and it is what a later session matches the task against. The body costs
nothing until it is loaded.

So write the description as *when to use this*, not *what this is*:

- Good: "Add a pony behavior, building, or shop item. Use when extending the reducer or
  gameData."
- Bad: "Game system helper."

Name the concrete things a request would mention — files, features, the words the user
would actually say.

## The Body

- **Be specific to this app.** Real paths, real function names, real commands read from
  \`package.json\`. A skill that could apply to any project is not worth loading.
- **Write the steps in order**, the way you just did them.
- **Say what not to do**, if you hit something that did not work. That is the part
  worth keeping.
- **Keep it under a couple of hundred lines.** It is read into a small context window.

## After Writing It

Say the name out loud to the user — a skill nobody knows exists is not much use. It is
available immediately; call \`load_skill\` with its name when the task comes round again.`
  }
]

/**
 * Whether a skill's body is still one anyapp shipped and has since corrected.
 * @param name - The skill's name
 * @param body - Its current body, as the loader parsed it
 * @returns True when the body matches a superseded seed exactly
 */
export function isSupersededSeed(name: string, body: string): boolean {
  return SUPERSEDED_SEEDS.some((seed) => seed.name === name && seed.body === body.trim())
}
