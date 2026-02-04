---
name: enhance-ui
description: Improve the Anyapp user interface using shadcn/ui and Tailwind CSS.
---

# UI Enhancement Guidelines

Use this skill when improving the Anyapp user interface.

## Component Library

Anyapp uses shadcn/ui components. Import from:

```typescript
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
```

## Styling Guidelines

### Tailwind CSS

- Use utility classes directly in components
- Follow mobile-first responsive design
- Use the neutral color palette for dark mode consistency
- Common patterns:
  - `bg-neutral-950` - main background
  - `bg-neutral-900` - card/panel background
  - `bg-neutral-800` - input/elevated surface
  - `text-neutral-50` - primary text
  - `text-neutral-400` - secondary text
  - `border-neutral-700/800` - borders

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

1. Run `bun run dev` to start hot reload
2. Test in the Electron window
3. Check responsive behavior
4. Verify dark mode consistency
5. Run `bun run typecheck:all` before committing
