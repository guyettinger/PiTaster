import { useCallback, useEffect, useRef, useState } from 'react'
import { LAYOUT_VERSION, applyDefaultLayout } from '../components/workspace/defaultLayout'
import type {
  DockviewApi,
  DockviewReadyEvent,
  DockviewIDisposable
} from 'dockview-react'

/**
 * How long to wait after the last layout change before writing it.
 *
 * dockview raises `onDidLayoutChange` continuously while a sash is dragged, so
 * without this the store would be rewritten dozens of times per gesture. Half a
 * second is long enough to collapse a whole drag into one write and short enough
 * that nothing is lost to a crash a person would blame on the app.
 */
const SAVE_DEBOUNCE_MS = 500

/**
 * What {@link useWorkspaceLayout} gives its caller.
 */
export interface WorkspaceLayoutHandle {
  /** The dock's API once it is ready, or null before then. */
  api: DockviewApi | null
  /** Pass to `DockviewReact`'s `onReady`. */
  onReady: (event: DockviewReadyEvent) => void
}

/**
 * Restore a sub-app's dock layout, and keep it saved.
 *
 * All the IPC for the layout lives here rather than in the component, so the
 * subscription and its teardown are in one place.
 *
 * The restore is deliberately forgiving. A layout can be missing, written
 * against an older panel set, or corrupt; in every one of those cases the right
 * answer is a working default workspace, not an error — nobody can repair a
 * `layouts.json` by hand, and a dock that fails to build leaves the app with no
 * UI at all.
 *
 * @param appId - The focused app. The dock is remounted when this changes, so
 *   the hook never has to migrate one app's layout onto another's.
 */
export function useWorkspaceLayout(appId: string): WorkspaceLayoutHandle {
  const [api, setApi] = useState<DockviewApi | null>(null)

  /**
   * The api this hook has already built a layout into. Keyed on the instance
   * rather than a boolean: StrictMode mounts, unmounts and remounts, and the
   * second mount is a *different* api that genuinely does need building.
   */
  const initializedApiRef = useRef<DockviewApi | null>(null)
  const subscriptionRef = useRef<DockviewIDisposable | null>(null)
  /** Set on unmount, so a restore still in flight does not touch a disposed api. */
  const unmountedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<unknown>(null)

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const layout = pendingRef.current
    if (layout === null) return
    pendingRef.current = null
    void window.electronAPI
      .saveWorkspaceLayout(appId, LAYOUT_VERSION, layout)
      .catch((cause: Error) => {
        console.error('Failed to save workspace layout:', cause)
      })
  }, [appId])

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const { api: readyApi } = event
      if (initializedApiRef.current === readyApi) return
      initializedApiRef.current = readyApi
      setApi(readyApi)

      const watch = (): void => {
        if (unmountedRef.current) return
        // Subscribed only after the layout is in place: `fromJSON` and
        // `applyDefaultLayout` both raise the change event, and saving what we
        // just restored is a write that can only ever lose information.
        subscriptionRef.current = readyApi.onDidLayoutChange(() => {
          pendingRef.current = readyApi.toJSON()
          if (timerRef.current !== null) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS)
        })
      }

      void window.electronAPI
        .getWorkspaceLayout(appId, LAYOUT_VERSION)
        .then((saved) => {
          if (unmountedRef.current) return
          if (saved && typeof saved === 'object') {
            try {
              readyApi.fromJSON(saved as Parameters<DockviewApi['fromJSON']>[0])
            } catch (cause) {
              console.error('Discarding an unusable saved layout:', cause)
              readyApi.clear()
              applyDefaultLayout(readyApi)
            }
          } else {
            applyDefaultLayout(readyApi)
          }
        })
        .catch((cause: Error) => {
          if (unmountedRef.current) return
          console.error('Failed to read workspace layout:', cause)
          applyDefaultLayout(readyApi)
        })
        .finally(watch)
    },
    [appId, flush]
  )

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      // The dock is remounted on every app switch, so this is the normal path,
      // not an edge case: without it the layout you just arranged is lost the
      // moment you open a different app.
      subscriptionRef.current?.dispose()
      subscriptionRef.current = null
      flush()
    }
  }, [flush])

  return { api, onReady }
}
