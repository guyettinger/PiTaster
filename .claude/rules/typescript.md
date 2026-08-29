---
paths:
  - "apps/*/src/**/*.{ts,tsx}"
  - "apps/*/*.config.ts"
  - "packages/*/src/**/*.ts"
---

# TypeScript Conventions and TSDoc

## Conventions

- Prefer `interface` over `type` for object shapes
- Use TSDoc comments (not JSDoc) for types, interfaces, functions, and components
- Use the `type` keyword for type-only imports
- Define response interfaces for API and IPC calls
- **Never use `any`** — use `unknown` and narrow with type guards, or define a proper interface

## Function Parameters

Functions with more than two parameters must use an object parameter with a typed interface:

```typescript
// Bad: more than 2 positional parameters
function createUser(name: string, email: string, age: number, role: string) {}

// Good: object parameter with interface
interface CreateUserParams {
  /** The user's full name. */
  name: string
  /** The user's email address. */
  email: string
  /** The user's age. */
  age: number
  /** The user's role. */
  role: string
}

function createUser(params: CreateUserParams) {}
```

## TSDoc Patterns

### Interfaces

Inline TSDoc on each property:

```typescript
/**
 * Represents a chat message.
 */
interface Message {
  /** The unique identifier for the message. */
  id: string
  /** The message content. */
  content: string
  /** The sender's role. */
  role: 'user' | 'assistant'
  /** Timestamp when message was created. */
  createdAt: Date
}
```

### Functions

Document parameters, return values, and exceptions:

```typescript
/**
 * Sends a message to the agent and streams the response.
 * @param message - The message content to send
 * @param options - Optional configuration for the request
 * @returns A promise that resolves when streaming is complete
 * @throws {Error} If the agent is not connected
 */
async function sendMessage(message: string, options?: SendOptions): Promise<void> {}
```

### Component Props

```typescript
import type { ReactNode } from "react"

/**
 * Props for the Card component.
 */
interface CardProps {
  /** Card title displayed in header. */
  title: string
  /** Optional card content. */
  children?: ReactNode
  /** Optional click handler. */
  onClick?: () => void
}
```

## Type Organization

- Local types: define in the same file if only used there
- Shared types: place in `packages/core/src/` for cross-package use
- Extract to a separate file when used by 3+ files
