---
name: react-query
description: TanStack Query patterns for data fetching, mutations, and cache management. Reference for if/when the renderer adopts the library — it is not currently a dependency.
---

# TanStack Query Patterns

> **Not currently used.** `@tanstack/react-query` is not a dependency of
> `@pitaster/electron` and appears nowhere in the source. The renderer gets its
> data by calling `window.electronAPI` and subscribing to streamed IPC events.
> This document is the pattern to follow **if** the library is adopted — it is
> not a description of existing code, and nothing should be written as if these
> hooks already exist.

## Query Hook Pattern

```typescript
import { useQuery, queryOptions } from "@tanstack/react-query"

/**
 * Response data for workspace sessions.
 */
interface SessionsResponse {
  /** List of session objects. */
  sessions: Session[]
  /** Total count of sessions. */
  total: number
}

/**
 * Creates query options for fetching workspace sessions.
 * @param workspaceId - The workspace identifier
 */
const sessionsQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: ["sessions", "list", workspaceId],
    queryFn: async () => {
      return window.electronAPI.getSessions(workspaceId) as Promise<SessionsResponse>
    },
    staleTime: 30 * 1000,
  })

/**
 * Hook to fetch workspace sessions.
 * @param workspaceId - The workspace identifier
 */
export function useSessions(workspaceId: string) {
  return useQuery(sessionsQueryOptions(workspaceId))
}
```

## Mutation Hook Pattern

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query"

/**
 * Parameters for creating a new session.
 */
interface CreateSessionParams {
  /** The workspace identifier. */
  workspaceId: string
  /** Optional session title. */
  title?: string
}

/**
 * Hook to create a new chat session.
 */
export function useCreateSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreateSessionParams) => {
      return window.electronAPI.createSession(params)
    },
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["sessions", "list", variables.workspaceId],
      })
    },
  })
}
```

## Optimistic Updates

```typescript
export function useUpdateSessionTitle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { sessionId: string; title: string }) => {
      return window.electronAPI.updateSession(params)
    },
    onMutate: async (newData) => {
      await queryClient.cancelQueries({
        queryKey: ["sessions", "detail", newData.sessionId],
      })

      const previousSession = queryClient.getQueryData<Session>([
        "sessions", "detail", newData.sessionId,
      ])

      queryClient.setQueryData(
        ["sessions", "detail", newData.sessionId],
        (old: Session | undefined) =>
          old ? { ...old, title: newData.title } : undefined
      )

      return { previousSession }
    },
    onError: (err, newData, context) => {
      if (context?.previousSession) {
        queryClient.setQueryData(
          ["sessions", "detail", newData.sessionId],
          context.previousSession
        )
      }
    },
  })
}
```

## Query Key Structure

Hierarchical: `["domain", "resource", ...params]`

```typescript
queryKey: ["sessions", "list", workspaceId]
queryKey: ["sessions", "detail", sessionId]
queryKey: ["sources", "list", workspaceId]
queryKey: ["skills", "list", workspaceId]
```

## Checklist

- Configure `staleTime` per data volatility (30s–5min)
- Use `enabled` to conditionally run queries
- Use the `queryOptions` helper for reusable configurations
- Invalidate in mutation `onSuccess`
- Use `mutateAsync` when composing side effects
- Don't fetch in `useEffect`

## Caveat for This Codebase

Much of Pi Taster's renderer data is **pushed** over IPC (streaming agent output,
terminal output, dev-server status), not pulled. Streams do not map onto
`useQuery`. If the library is adopted, use it for the request/response calls
(sessions, sources, skills, version history) and keep the subscription-based
data in custom hooks around `window.electronAPI`.
