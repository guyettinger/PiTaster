import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { PermissionMode } from '../../types/electron'
import type { SubApp } from '@anyapp/core'

/**
 * Everything a workspace panel needs that cannot travel in its `params`.
 *
 * dockview serializes a panel's `params` into the saved layout, so anything
 * that is not a plain, stable value — every callback, and the `SubApp` itself —
 * has to reach panels another way. Only the Code panel carries a `param` at
 * all, and it is a string.
 */
export interface WorkspaceContextValue {
  /** The focused app. */
  app: SubApp
  /** The agent's permission mode. */
  permissionMode: PermissionMode
  /** The active chat session, or null while one is being resolved. */
  activeSessionId: string | null
  /** Change how much the agent is allowed to do. */
  onModeChange: (mode: PermissionMode) => void
  /** Switch to a chat session. */
  onSessionSelect: (sessionId: string) => void
  /** Start a new chat session. */
  onSessionCreate: () => void
  /** Roll the app back to a commit. */
  onRollback: (commitId: string) => void
  /** Switch to a branch. */
  onBranchSwitch: (branchName: string) => void
  /** Create a branch. */
  onBranchCreate: (name: string) => void
  /** Leave the workspace for the Skills destination. */
  onOpenSkills: () => void
  /** Open a file as its own Code panel, focusing it if already open. */
  openFile: (path: string) => void
  /**
   * Bumped whenever something moves HEAD from outside a conversation.
   *
   * The composer's changed-files strip is a diff against a fixed commit, so a
   * rollback or a branch switch in the History panel invalidates it. Only those
   * two bump it: it lives in the context value, so every bump re-renders every
   * panel, and a per-turn refresh would do that on every turn. Chat counts its
   * own turns locally.
   */
  changesRevision: number
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

/**
 * Props for the WorkspaceProvider component.
 */
interface WorkspaceProviderProps {
  /** The value every panel reads. Must be memoized by the caller. */
  value: WorkspaceContextValue
  /** The dock. */
  children: ReactNode
}

/**
 * Supplies every dock panel with the props the layout cannot carry.
 *
 * The `value` must be memoized. Panels render inside dockview's own render
 * cycle rather than as children of whoever owns this state, so an object
 * rebuilt on each render re-renders all of them — including mid-stream, when
 * the transcript is the most expensive tree in the app.
 */
export function WorkspaceProvider({ value, children }: WorkspaceProviderProps) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

/**
 * Read the workspace context from inside a panel.
 * @returns The focused app and the handlers panels act through
 * @throws {Error} If called outside a {@link WorkspaceProvider}
 */
export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)
  if (!value) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider')
  }
  return value
}
