import { useState, useEffect, useCallback } from 'react'
import { PlayIcon, StopIcon, TrashIcon, BranchIcon, PlusIcon, AppsIcon, CloseIcon } from './icons'
import { AppIcon } from './AppIcon'
import type { SubApp, AppTemplate } from '@keylimepi/core'
import { useRunningApps } from '../context/RunningAppsContext'
import { formatRelativeTime } from '../lib/relativeTime'
import { TEMPLATES, RUNNABLE_TEMPLATES } from './appTemplates'

/**
 * Props for the AppListing component.
 */
interface AppListingProps {
  /** Callback when an app is selected. */
  onAppSelect: (app: SubApp) => void
  /** Currently active app ID. */
  activeAppId: string | null
  /** Ids of the apps that already have a tile in the nav rail. */
  openAppIds: readonly string[]
}

/**
 * App listing component for managing sub-apps.
 */
export function AppListing({ onAppSelect, activeAppId, openAppIds }: AppListingProps) {
  const [apps, setApps] = useState<SubApp[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [newAppName, setNewAppName] = useState('')
  const [newAppDescription, setNewAppDescription] = useState('')
  const [newAppTemplate, setNewAppTemplate] = useState<AppTemplate>('react-vite')
  const [error, setError] = useState<string | null>(null)

  const loadApps = useCallback(async () => {
    setIsLoading(true)
    try {
      const appList = await window.electronAPI.listApps()
      setApps(appList)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load apps')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadApps()
  }, [loadApps])

  const handleCreate = useCallback(async () => {
    if (!newAppName.trim()) return
    
    setError(null)
    try {
      const app = await window.electronAPI.createApp({
        name: newAppName,
        description: newAppDescription,
        template: newAppTemplate
      })
      setApps(prev => [app, ...prev])
      setIsCreating(false)
      setNewAppName('')
      setNewAppDescription('')
      onAppSelect(app)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create app')
    }
  }, [newAppName, newAppDescription, newAppTemplate, onAppSelect])

  const handleDelete = useCallback(async (app: SubApp) => {
    if (!confirm(`Delete "${app.name}"? This cannot be undone.`)) return
    
    try {
      await window.electronAPI.deleteApp(app.id)
      setApps(prev => prev.filter(a => a.id !== app.id))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete app')
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-line px-6 py-4">
        {/* The header's row takes the body's cap, so its action ends where the
            cards below it end rather than out at the page gutter. */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[15px] font-semibold text-bone">Apps</h1>
            <p className="text-[12px] text-ash">
              Sandboxed projects the agent builds and modifies, in{' '}
              <code className="font-mono">~/.keylimepi/apps</code>
            </p>
          </div>
          <button
            onClick={() => setIsCreating(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-keylime px-3 py-1.5 text-[13px] font-medium text-ground transition-opacity hover:opacity-90"
          >
            <PlusIcon size={14} />
            New app
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-rust/40 bg-rust/10 px-4 py-3">
          <p className="flex-1 text-[13px] text-bone">{error}</p>
          <button
            onClick={() => setError(null)}
            className="shrink-0 rounded p-1 text-ash transition-colors hover:text-bone"
            title="Dismiss"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {/* Create Form */}
      {isCreating && (
        <CreateAppForm
          name={newAppName}
          description={newAppDescription}
          template={newAppTemplate}
          onNameChange={setNewAppName}
          onDescriptionChange={setNewAppDescription}
          onTemplateChange={setNewAppTemplate}
          onCreate={handleCreate}
          onCancel={() => setIsCreating(false)}
        />
      )}

      {/* App List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="px-6 py-5 text-[13px] text-ash">Loading apps…</p>
        ) : apps.length === 0 ? (
          <EmptyState onCreateClick={() => setIsCreating(true)} />
        ) : (
          <div className="px-6 py-5">
            <ul className="space-y-2">
              {apps.map(app => (
                <AppCard
                  key={app.id}
                  app={app}
                  isActive={app.id === activeAppId}
                  isOpen={openAppIds.includes(app.id)}
                  onSelect={() => onAppSelect(app)}
                  onDelete={() => handleDelete(app)}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Props for the CreateAppForm component.
 */
interface CreateAppFormProps {
  name: string
  description: string
  template: AppTemplate
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onTemplateChange: (value: AppTemplate) => void
  onCreate: () => void
  onCancel: () => void
}

/**
 * Form for creating a new app.
 */
function CreateAppForm({
  name,
  description,
  template,
  onNameChange,
  onDescriptionChange,
  onTemplateChange,
  onCreate,
  onCancel
}: CreateAppFormProps) {
  return (
    <div className="border-b border-line bg-panel/50 p-4">
      <h3 className="mb-3 font-medium">Create New App</h3>
      
      <div className="space-y-3">
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="App name"
          className="w-full rounded border border-line bg-raised px-3 py-2 text-sm transition-colors hover:border-ash"
          autoFocus
        />
        
        <input
          type="text"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Description (optional)"
          className="w-full rounded border border-line bg-raised px-3 py-2 text-sm transition-colors hover:border-ash"
        />
        
        <div>
          <label className="mb-2 block text-sm text-ash">Template</label>
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map(t => (
              <button
                key={t.id}
                onClick={() => onTemplateChange(t.id)}
                className={`rounded border p-2 text-left text-sm transition-colors ${
                  template === t.id
                    ? 'border-keylime/40 bg-keylime/10'
                    : 'border-line hover:border-line'
                }`}
              >
                <span className="mr-2">{t.icon}</span>
                {t.name}
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex gap-2 pt-2">
          <button
            onClick={onCreate}
            disabled={!name.trim()}
            className="flex-1 rounded bg-keylime px-3 py-2 text-sm text-ground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create App
          </button>
          <button
            onClick={onCancel}
            className="rounded border border-line px-3 py-2 text-sm hover:bg-raised"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Props for the AppCard component.
 */
interface AppCardProps {
  app: SubApp
  isActive: boolean
  /** Whether this app already has a tile in the nav rail. */
  isOpen: boolean
  onSelect: () => void
  onDelete: () => void
}

/**
 * Card displaying a single app.
 */
function AppCard({ app, isActive, isOpen, onSelect, onDelete }: AppCardProps) {
  const { isRunning, getStatus, getUrl, startApp, stopApp } = useRunningApps()

  const running = isRunning(app.id)
  const status = getStatus(app.id)
  const url = getUrl(app.id)

  const isRunnable = RUNNABLE_TEMPLATES.includes(app.template)

  return (
    <li
      className={`relative rounded-lg border p-4 transition-colors ${
        isActive
          ? 'border-keylime/50 bg-keylime/10'
          : 'border-line bg-panel hover:border-ash/50'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {/*
            The same mark the nav rail draws, one register brighter. Every card
            is `full` because the library is where you tell apps apart and there
            is no focus here for the hue to defer to — the card's own keylime
            border already says which app is active.

            It replaced the template emoji, which was the only icon here and the
            weaker of the two: a glyph shared by every app from one template
            cannot distinguish the apps it is drawn beside, which is the one job
            an icon in a list has.
          */}
          <AppIcon app={app} size="list" emphasis="full" />
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-medium">
                {/*
                 * The card's whole surface opens the app, but the control that
                 * does it is this one real button — stretched over the card by
                 * its own `::after`. That keeps one tab stop and one accessible
                 * name (the app's) for the card, while the run and delete
                 * buttons stay siblings above it rather than nested inside a
                 * clickable ancestor. The focus ring is drawn on the stretched
                 * pseudo-element, so it outlines the card, not the name.
                 */}
                <button
                  onClick={onSelect}
                  aria-current={isActive ? 'true' : undefined}
                  className="cursor-pointer text-left after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-keylime"
                >
                  {app.name}
                </button>
              </h4>
              {/*
                Says which apps already have a rail tile. Without it the library
                gives no hint that clicking an app will focus the tile it
                already has rather than open a new one — and at the cap, that
                distinction is what explains why an older tile gave way.
              */}
              {isOpen && !isActive && (
                <span className="eyebrow rounded border border-line px-1 py-0.5 text-ash">
                  Open
                </span>
              )}
              {/* Running indicator */}
              {status && (
                <span className={`h-2 w-2 rounded-full ${
                  status === 'running' ? 'bg-patina' :
                  status === 'starting' ? 'animate-pulse bg-keylime' :
                  status === 'error' ? 'bg-rust' : ''
                }`}>
                  <span className="sr-only">{status}</span>
                </span>
              )}
            </div>
            {app.description && (
              <p className="line-clamp-1 text-sm text-ash">
                {app.description}
              </p>
            )}
          </div>
        </div>

        {/* Raised above the stretched button so these keep their own clicks. */}
        <div className="relative z-10 flex items-center gap-1">
          {/* Quick run/stop button */}
          {isRunnable && (
            running ? (
              <button
                onClick={() => stopApp(app.id)}
                disabled={status === 'starting'}
                className="rounded p-1.5 text-ash transition-colors hover:bg-raised hover:text-rust disabled:opacity-50"
                aria-label={`Stop ${app.name}`}
                title="Stop the dev server"
              >
                <StopIcon size={15} />
              </button>
            ) : (
              <button
                onClick={() => startApp(app.id)}
                className="rounded p-1.5 text-ash transition-colors hover:bg-raised hover:text-patina"
                aria-label={`Start ${app.name}`}
                title="Start the dev server"
              >
                <PlayIcon size={15} />
              </button>
            )
          )}

          {/* Delete button - disabled while running */}
          <button
            onClick={onDelete}
            disabled={running}
            className="rounded p-1.5 text-ash transition-colors hover:text-rust disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Delete ${app.name}`}
            title={running ? 'Stop this app before deleting it' : 'Delete this app'}
          >
            <TrashIcon size={15} />
          </button>
        </div>
      </div>
      
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11.5px] text-ash">
        {app.currentBranch && (
          <span className="flex items-center gap-1 font-mono">
            <BranchIcon size={12} />
            {app.currentBranch}
          </span>
        )}
        {app.hasChanges && (
          <span className="flex items-center gap-1 text-keylime">
            <span className="h-1.5 w-1.5 rounded-full bg-keylime" />
            Uncommitted
          </span>
        )}
        {/* Show port when running */}
        {running && url && (
          <span className="text-patina">
            :{new URL(url).port}
          </span>
        )}
        <span>Updated {formatRelativeTime(app.updatedAt)}</span>
      </div>
    </li>
  )
}

/**
 * Empty state when no apps exist.
 */
function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="text-ash">
        <AppsIcon size={28} />
      </span>
      <h2 className="mt-3 text-[15px] font-semibold text-bone">No apps yet</h2>
      <p className="mt-1 max-w-xs text-[13px] text-ash">
        Create one and the agent will scaffold it, then change it on request. Every write
        is committed, so nothing you try is permanent.
      </p>
      <button
        onClick={onCreateClick}
        className="mt-4 rounded-lg bg-keylime px-4 py-2 text-[13px] font-medium text-ground transition-opacity hover:opacity-90"
      >
        New app
      </button>
    </div>
  )
}
