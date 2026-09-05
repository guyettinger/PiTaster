import { useState, useEffect, useCallback, useRef } from 'react'
import type { SubApp, OpenAppsState } from '@pitaster/core'

/**
 * The set of apps with a tile in the nav rail, and which one has focus.
 *
 * The rail is the shell's tab bar, so this is the state behind it: which apps
 * are open, in what order, and which one the workspace is showing. It is
 * persisted through main so that a restart restores the same tiles — the same
 * promise an editor's open tabs make.
 *
 * Apps are held as whole {@link SubApp} records rather than ids because the rail
 * draws each tile from its name and template, and the workspace needs the record
 * anyway. The persisted form is ids alone; this hook resolves them on mount.
 */
export interface UseOpenApps {
  /** The open apps, in rail order. */
  openApps: SubApp[]
  /** The focused app, or null when the shell is showing no workspace. */
  focusedApp: SubApp | null
  /** Whether the persisted set has been restored yet. */
  isRestoring: boolean
  /** Open an app if it is not already open, and focus it. */
  openApp: (app: SubApp) => void
  /** Focus an app that is already open. */
  focusApp: (appId: string) => void
  /** Close an app's tile, focusing a neighbour if it had focus. */
  closeApp: (appId: string) => void
  /** Replace an open app's record in place, after it changed on disk. */
  replaceApp: (app: SubApp) => void
}

/**
 * The most apps that may be open at once.
 *
 * Mirrors `MAX_OPEN_APPS` in `main/open-apps-store.ts`, which enforces it on the
 * value that is actually written. The renderer cannot import from main, and the
 * store re-validates — the same arrangement the Settings bounds already use.
 */
const MAX_OPEN_APPS = 4

/**
 * Track which apps are open in the rail.
 * @returns The open set and the operations the shell performs on it
 */
export function useOpenApps(): UseOpenApps {
  const [openApps, setOpenApps] = useState<SubApp[]>([])
  const [focusedAppId, setFocusedAppId] = useState<string | null>(null)
  const [isRestoring, setIsRestoring] = useState(true)

  // Restoring writes the same state it just read. Without this guard that write
  // races the read on a slow disk and can persist an empty set over a real one.
  const hasRestored = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function restore(): Promise<void> {
      try {
        const [state, apps] = await Promise.all([
          window.electronAPI.getOpenApps(),
          window.electronAPI.listApps()
        ])
        if (cancelled) return

        // Main already pruned ids whose directory is gone; this resolves what
        // survived, in the saved order, and drops anything `listApps` does not
        // know about rather than rendering a tile that opens nothing.
        const byId = new Map(apps.map((app) => [app.id, app]))
        const restored = state.openAppIds
          .map((id) => byId.get(id))
          .filter((app): app is SubApp => app !== undefined)

        setOpenApps(restored)
        setFocusedAppId(
          state.focusedAppId !== null && restored.some((app) => app.id === state.focusedAppId)
            ? state.focusedAppId
            : null
        )
      } catch {
        // A shell that cannot restore its tabs still has to open. The library is
        // one click away, which is where a first launch starts anyway.
      } finally {
        if (!cancelled) {
          hasRestored.current = true
          setIsRestoring(false)
        }
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [])

  // Persist on every change, once the restore that would race it has finished.
  useEffect(() => {
    if (!hasRestored.current) return
    const state: OpenAppsState = {
      openAppIds: openApps.map((app) => app.id),
      focusedAppId
    }
    void window.electronAPI.setOpenApps(state).catch(() => {
      // Losing the tab set across a restart is a nuisance, not a failure worth
      // interrupting the user over.
    })
  }, [openApps, focusedAppId])

  const openApp = useCallback((app: SubApp) => {
    setOpenApps((current) => {
      const existing = current.findIndex((open) => open.id === app.id)
      // Re-opening refreshes the record in place rather than moving the tile.
      // A tile that jumps position when you click it is a tile you cannot aim at.
      if (existing !== -1) {
        const next = [...current]
        next[existing] = app
        return next
      }
      // At the cap the oldest tile that is not focused gives way, so opening an
      // app always succeeds rather than silently doing nothing.
      const next = [...current, app]
      return next.length > MAX_OPEN_APPS ? next.slice(next.length - MAX_OPEN_APPS) : next
    })
    setFocusedAppId(app.id)
  }, [])

  const focusApp = useCallback((appId: string) => {
    setOpenApps((current) => {
      if (current.some((app) => app.id === appId)) setFocusedAppId(appId)
      return current
    })
  }, [])

  const closeApp = useCallback((appId: string) => {
    setOpenApps((current) => {
      const index = current.findIndex((app) => app.id === appId)
      if (index === -1) return current
      const next = current.filter((app) => app.id !== appId)

      setFocusedAppId((focused) => {
        if (focused !== appId) return focused
        if (next.length === 0) return null
        // Focus the neighbour that took its place, or the new last tile — the
        // pointer is already there, which is where a closed tab should hand off.
        return (next[index] ?? next[next.length - 1]).id
      })

      return next
    })
  }, [])

  const replaceApp = useCallback((app: SubApp) => {
    setOpenApps((current) => {
      const index = current.findIndex((open) => open.id === app.id)
      if (index === -1) return current
      const next = [...current]
      next[index] = app
      return next
    })
  }, [])

  const focusedApp = openApps.find((app) => app.id === focusedAppId) ?? null

  return {
    openApps,
    focusedApp,
    isRestoring,
    openApp,
    focusApp,
    closeApp,
    replaceApp
  }
}
