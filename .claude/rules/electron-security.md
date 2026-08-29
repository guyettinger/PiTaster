---
paths:
  - "apps/electron/src/{main,preload}/**/*.ts"
---

# Electron Security

These rules are not stylistic. Violating them is a security bug.

## BrowserWindow Configuration

Always set these webPreferences:

```typescript
new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,  // REQUIRED - isolates preload from renderer
    nodeIntegration: false,  // REQUIRED - no Node.js in renderer
    sandbox: true            // RECOMMENDED - OS-level sandboxing
  }
})
```

## Preload Script Patterns

### BAD — never expose raw ipcRenderer

```typescript
// DANGEROUS: exposes full IPC capabilities
contextBridge.exposeInMainWorld('electronAPI', {
  on: ipcRenderer.on
})

// DANGEROUS: leaks the event object to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  onUpdate: (callback) => ipcRenderer.on('update', callback)
})
```

### GOOD — expose specific functions, unwrap events

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  // invoke for request/response
  sendMessage: (msg: string) => ipcRenderer.invoke('agent:message', msg),

  // filter event data - never pass the raw event through
  onStream: (callback: (data: string) => void) => {
    ipcRenderer.on('agent:stream', (_event, data) => callback(data))
  }
})
```

Every function added to the bridge needs a matching entry in
`apps/electron/src/renderer/src/types/electron.d.ts`.

## IPC Handler Security

The renderer is untrusted. Validate type and length of every argument in the
main process before acting on it:

```typescript
ipcMain.handle('agent:message', async (event, message) => {
  if (typeof message !== 'string' || message.length > 100000) {
    throw new Error('Invalid message')
  }
  // Process validated input
})
```

## Environment Variable Filtering

Block sensitive vars when spawning subprocesses:

```typescript
const BLOCKED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN'
]

const filteredEnv = Object.fromEntries(
  Object.entries(process.env)
    .filter(([key]) => !BLOCKED_ENV_VARS.includes(key))
)
```

## Credential Storage

anyapp currently stores no secrets: inference runs on a local Ollama daemon, so
there is no API key. Nothing in the app calls `safeStorage` today.

If you add a remote provider, or anything else with a credential, use Electron's
`safeStorage` — never plain files or renderer storage:

```typescript
import { safeStorage } from 'electron'

const encrypted = safeStorage.encryptString(apiKey)
const decrypted = safeStorage.decryptString(encrypted)
```
