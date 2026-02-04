# Session 6.3: App Listing UI

## Overview

This sub-session builds the React components for managing sub-apps in the UI.

**Estimated scope**: Small  
**Prerequisites**: Session 6.2 complete  
**Deliverable**: AppListing and AppHeader components

## Objectives

1. Create AppListing component for managing apps
2. Create AppHeader component for active app context
3. Add template selector UI

---

## Task 1: AppListing Component

### Create apps/electron/src/renderer/src/components/AppListing.tsx

```tsx
import { useState, useEffect, useCallback } from 'react'
import type { SubApp, AppTemplate } from '@anyapp/core'

interface AppListingProps {
  onAppSelect: (app: SubApp) => void
  activeAppId: string | null
}

const TEMPLATES: { id: AppTemplate; name: string; icon: string }[] = [
  { id: 'react-vite', name: 'React + Vite', icon: '⚛️' },
  { id: 'node-cli', name: 'Node CLI', icon: '💻' },
  { id: 'node-server', name: 'Node Server', icon: '🌐' },
  { id: 'static-site', name: 'Static Site', icon: '📄' },
  { id: 'blank', name: 'Blank', icon: '📁' }
]

export function AppListing({ onAppSelect, activeAppId }: AppListingProps) {
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
      <div className="flex items-center justify-between border-b border-neutral-800 p-4">
        <h2 className="text-lg font-semibold">Your Apps</h2>
        <button
          onClick={() => setIsCreating(true)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-700"
        >
          + New App
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 rounded border border-red-700 bg-red-900/50 p-3 text-sm text-red-200">
          {error}
          <button 
            onClick={() => setError(null)}
            className="ml-2 text-red-400 hover:text-red-300"
          >
            ✕
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
          <div className="p-4 text-center text-neutral-500">Loading...</div>
        ) : apps.length === 0 ? (
          <EmptyState onCreateClick={() => setIsCreating(true)} />
        ) : (
          <div className="p-2">
            {apps.map(app => (
              <AppCard
                key={app.id}
                app={app}
                isActive={app.id === activeAppId}
                onSelect={() => onAppSelect(app)}
                onDelete={() => handleDelete(app)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

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
    <div className="border-b border-neutral-800 bg-neutral-900/50 p-4">
      <h3 className="mb-3 font-medium">Create New App</h3>
      
      <div className="space-y-3">
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="App name"
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          autoFocus
        />
        
        <input
          type="text"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Description (optional)"
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        
        <div>
          <label className="mb-2 block text-sm text-neutral-400">Template</label>
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map(t => (
              <button
                key={t.id}
                onClick={() => onTemplateChange(t.id)}
                className={`rounded border p-2 text-left text-sm transition-colors ${
                  template === t.id
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-neutral-700 hover:border-neutral-600'
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
            className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create App
          </button>
          <button
            onClick={onCancel}
            className="rounded border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

interface AppCardProps {
  app: SubApp
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
}

function AppCard({ app, isActive, onSelect, onDelete }: AppCardProps) {
  const templateIcons: Record<AppTemplate, string> = {
    'react-vite': '⚛️',
    'node-cli': '💻',
    'node-server': '🌐',
    'static-site': '📄',
    'blank': '📁'
  }

  return (
    <div
      className={`mb-2 cursor-pointer rounded-lg p-3 transition-colors ${
        isActive
          ? 'border border-blue-500 bg-blue-600/20'
          : 'border border-transparent bg-neutral-800/50 hover:bg-neutral-800'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{templateIcons[app.template]}</span>
          <div>
            <h4 className="font-medium">{app.name}</h4>
            {app.description && (
              <p className="line-clamp-1 text-sm text-neutral-400">
                {app.description}
              </p>
            )}
          </div>
        </div>
        
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="p-1 text-neutral-500 transition-colors hover:text-red-400"
          title="Delete app"
        >
          🗑️
        </button>
      </div>
      
      <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
        {app.currentBranch && (
          <span className="flex items-center gap-1">
            🌿 {app.currentBranch}
          </span>
        )}
        {app.hasChanges && (
          <span className="text-yellow-500">● Uncommitted</span>
        )}
        <span>Updated {formatRelativeTime(app.updatedAt)}</span>
      </div>
    </div>
  )
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="p-8 text-center">
      <div className="mb-3 text-4xl">📱</div>
      <h3 className="mb-1 font-medium">No apps yet</h3>
      <p className="mb-4 text-sm text-neutral-500">
        Create your first app to get started
      </p>
      <button
        onClick={onCreateClick}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        Create App
      </button>
    </div>
  )
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return date.toLocaleDateString()
}
```

---

## Task 2: AppHeader Component

### Create apps/electron/src/renderer/src/components/AppHeader.tsx

```tsx
import type { SubApp, AppTemplate } from '@anyapp/core'

interface AppHeaderProps {
  app: SubApp | null
  onBack: () => void
}

const TEMPLATE_LABELS: Record<AppTemplate, string> = {
  'react-vite': 'React + Vite',
  'node-cli': 'Node CLI',
  'node-server': 'Node Server',
  'static-site': 'Static Site',
  'blank': 'Blank Project'
}

export function AppHeader({ app, onBack }: AppHeaderProps) {
  if (!app) return null

  return (
    <div className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-900/50 px-4 py-2">
      <button
        onClick={onBack}
        className="rounded p-1.5 transition-colors hover:bg-neutral-800"
        title="Back to app list"
      >
        ←
      </button>
      
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-medium">{app.name}</h2>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span>{TEMPLATE_LABELS[app.template]}</span>
          {app.currentBranch && (
            <>
              <span>•</span>
              <span className="flex items-center gap-1">
                🌿 {app.currentBranch}
              </span>
            </>
          )}
          {app.hasChanges && (
            <>
              <span>•</span>
              <span className="text-yellow-500">Uncommitted changes</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
```

---

## Task 3: NoAppSelected Component

### Create apps/electron/src/renderer/src/components/NoAppSelected.tsx

```tsx
interface NoAppSelectedProps {
  onGoToApps: () => void
}

export function NoAppSelected({ onGoToApps }: NoAppSelectedProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mb-3 text-4xl">📱</div>
        <h3 className="mb-1 font-medium">No app selected</h3>
        <p className="mb-4 text-sm text-neutral-500">
          Select or create an app to start chatting
        </p>
        <button
          onClick={onGoToApps}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Go to Apps
        </button>
      </div>
    </div>
  )
}
```

---

## Verification Checklist

- [ ] `AppListing.tsx` created with create/list/delete functionality
- [ ] `AppHeader.tsx` created showing active app context
- [ ] `NoAppSelected.tsx` created for empty state
- [ ] Template selector shows all 5 templates
- [ ] Delete confirmation dialog works
- [ ] Relative time formatting works
- [ ] Components follow project styling conventions

## Commit Checkpoint

```bash
git add -A
git commit -m "feat(6.3): add app listing UI components

- Create AppListing with create form and app cards
- Create AppHeader for active app context display
- Create NoAppSelected empty state component
- Add template selector with icons
- Support app deletion with confirmation"
```

---

## Next

Proceed to **SESSION-6.4-IPC-INTEGRATION.md** to wire up the IPC handlers.
