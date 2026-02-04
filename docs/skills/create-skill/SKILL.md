---
name: create-skill
description: Create new skills for Anyapp. Use when user wants to add new agent capabilities.
---

# Creating Skills

Use this skill to create new skills for Anyapp.

## Skill Structure

Skills are stored in `~/.anyapp/skills/{name}/SKILL.md`

```
~/.anyapp/skills/
├── my-skill/
│   └── SKILL.md
├── another-skill/
│   └── SKILL.md
```

## SKILL.md Format

```markdown
---
name: skill-name
description: Brief description for when to use this skill.
---

# Skill Title

Instructions for the agent when this skill is activated...
```

### Frontmatter Fields

- `name`: Kebab-case identifier (must match folder name)
- `description`: 1-2 sentence description with trigger words

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
- Examples: `create-component`, `debug-error`, `optimize-performance`

## Using Skills

Users activate skills by mentioning them with `@`:

```
@create-skill Create a new skill for database migrations
```

Multiple skills can be combined:

```
@enhance-ui @create-component Add a new settings dialog
```

## Example Skill

```markdown
---
name: add-test
description: Write tests for React components using Vitest and Testing Library.
---

# Writing Tests

## Test File Location

Place tests next to the component:

- `components/Button.tsx`
- `components/Button.test.tsx`

## Test Structure

\`\`\`typescript
import { render, screen } from '@testing-library/react'
import { Button } from './Button'

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })
})
\`\`\`
```
