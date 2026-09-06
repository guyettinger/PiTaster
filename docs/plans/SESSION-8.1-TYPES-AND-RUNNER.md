# Session 8.1: Types and AppRunner

## Overview

This sub-session adds the core type definitions and AppRunner class for managing dev server processes with automatic port assignment.

**Estimated scope**: Small  
**Prerequisites**: Session 6 complete  
**Deliverable**: Type definitions and AppRunner class with port management

## Objectives

1. Add running app types to `packages/core`
2. Create AppRunner class with start/stop/logs functionality
3. Implement port detection to avoid conflicts

---

## Task 1: Type Definitions

### Update packages/core/src/apps.ts

Add these new types after the existing ones:

```typescript
/**
 * Running app state.
 */
export interface RunningApp {
  /** App ID that is running. */
  appId: string
  /** Process ID. */
  pid: number
  /** URL where the app is accessible, or null if not a web app. */
  url: string | null
  /** Port the app is running on. */
  port: number
  /** ISO timestamp when started. */
  startedAt: string
}

/**
 * App log entry.
 */
export interface AppLogEntry {
  /** App ID that produced this log. */
  appId: string
  /** ISO timestamp. */
  timestamp: string
  /** Log source type. */
  type: 'stdout' | 'stderr' | 'system'
  /** Log message content. */
  message: string
}

/**
 * Status change event for running apps.
 */
export interface AppStatusChange {
  /** App ID. */
  appId: string
  /** New status. */
  status: 'starting' | 'running' | 'stopped' | 'error'
  /** URL if running. */
  url?: string
  /** Port if running. */
  port?: number
  /** Error message if status is 'error'. */
  error?: string
}

/**
 * Port configuration for a template.
 */
export interface PortConfig {
  /** Starting port number. */
  base: number
  /** Maximum port number. */
  max: number
}

/**
 * Run configuration for a template.
 */
export interface AppRunConfig {
  /** Command to run (e.g., 'bun'). */
  command: string
  /** Base arguments (e.g., ['run', 'dev']). */
  args: string[]
  /** Port configuration. */
  ports: PortConfig
  /** How to pass port (cli flag or env var name). */
  portFlag: string | null
  /** Pattern to detect when server is ready. */
  readyPattern: RegExp | null
}
```

---

## Task 2: AppRunner Class

### Create packages/shared/src/apps/runner.ts

```typescript
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { EventEmitter } from 'node:events'
import type { 
  AppTemplate, 
  RunningApp, 
  AppLogEntry, 
  AppStatusChange,
  AppRunConfig 
} from '@keylimepi/core'

/** Environment variables to filter out when spawning processes. */
const BLOCKED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
  'NPM_TOKEN'
]

/** Run configurations per template. */
const RUN_CONFIGS: Record<AppTemplate, AppRunConfig> = {
  'react-vite': {
    command: 'bun',
    args: ['run', 'dev', '--'],
    ports: { base: 5200, max: 5299 },
    portFlag: '--port',
    readyPattern: /Local:\s+http/
  },
  'node-server': {
    command: 'bun',
    args: ['run', 'dev'],
    ports: { base: 3100, max: 3199 },
    portFlag: 'PORT', // env var
    readyPattern: /Server running|listening/i
  },
  'static-site': {
    command: 'npx',
    args: ['serve', '.', '-l'],
    ports: { base: 3200, max: 3299 },
    portFlag: null, // port is last arg
    readyPattern: /Serving!/
  },
  'node-cli': {
    command: 'bun',
    args: ['run', 'start'],
    ports: { base: 0, max: 0 },
    portFlag: null,
    readyPattern: null
  },
  'blank': {
    command: '',
    args: [],
    ports: { base: 0, max: 0 },
    portFlag: null,
    readyPattern: null
  }
}

/**
 * Manages running dev server processes for sub-apps.
 */
export class AppRunner extends EventEmitter {
  /** Map of running apps by ID. */
  private running = new Map<string, { process: ChildProcess; info: RunningApp }>()
  
  /** Map of assigned ports to prevent conflicts. */
  private assignedPorts = new Set<number>()

  /**
   * Check if a port is available.
   */
  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen(port, '127.0.0.1')
    })
  }

  /**
   * Find an available port in the given range.
   */
  private async findAvailablePort(base: number, max: number): Promise<number> {
    for (let port = base; port <= max; port++) {
      if (this.assignedPorts.has(port)) continue
      const available = await this.isPortAvailable(port)
      if (available) {
        this.assignedPorts.add(port)
        return port
      }
    }
    throw new Error(`No available port in range ${base}-${max}`)
  }

  /**
   * Get filtered environment variables.
   */
  private getFilteredEnv(): NodeJS.ProcessEnv {
    return Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !BLOCKED_ENV_VARS.includes(key)
      )
    )
  }

  /**
   * Build the command args with port.
   */
  private buildArgs(config: AppRunConfig, port: number): string[] {
    const args = [...config.args]
    
    if (config.portFlag === '--port') {
      // Vite style: --port 5200
      args.push('--port', String(port))
    } else if (config.portFlag === null && config.ports.base > 0) {
      // serve style: -l 3200
      args.push(String(port))
    }
    
    return args
  }

  /**
   * Build environment with port if needed.
   */
  private buildEnv(config: AppRunConfig, port: number): NodeJS.ProcessEnv {
    const env = this.getFilteredEnv()
    
    if (config.portFlag === 'PORT') {
      env.PORT = String(port)
    }
    
    return env
  }

  /**
   * Emit a log entry.
   */
  private emitLog(appId: string, type: AppLogEntry['type'], message: string): void {
    const entry: AppLogEntry = {
      appId,
      timestamp: new Date().toISOString(),
      type,
      message
    }
    this.emit('log', entry)
  }

  /**
   * Emit a status change.
   */
  private emitStatus(change: AppStatusChange): void {
    this.emit('status', change)
  }

  /**
   * Start a dev server for an app.
   */
  async start(appId: string, appPath: string, template: AppTemplate): Promise<RunningApp> {
    // Check if already running
    if (this.running.has(appId)) {
      throw new Error(`App ${appId} is already running`)
    }

    const config = RUN_CONFIGS[template]
    
    // Check if template is runnable
    if (!config.command) {
      throw new Error(`Template ${template} is not runnable`)
    }

    // Find available port
    let port = 0
    if (config.ports.base > 0) {
      port = await this.findAvailablePort(config.ports.base, config.ports.max)
    }

    const args = this.buildArgs(config, port)
    const env = this.buildEnv(config, port)

    this.emitLog(appId, 'system', `Starting ${config.command} ${args.join(' ')}`)
    this.emitStatus({ appId, status: 'starting' })

    const proc = spawn(config.command, args, {
      cwd: appPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const info: RunningApp = {
      appId,
      pid: proc.pid!,
      url: port > 0 ? `http://localhost:${port}` : null,
      port,
      startedAt: new Date().toISOString()
    }

    this.running.set(appId, { process: proc, info })

    // Handle stdout
    proc.stdout?.on('data', (data: Buffer) => {
      const message = data.toString()
      this.emitLog(appId, 'stdout', message)
      
      // Check for ready pattern
      if (config.readyPattern?.test(message)) {
        this.emitStatus({ 
          appId, 
          status: 'running', 
          url: info.url ?? undefined,
          port 
        })
      }
    })

    // Handle stderr
    proc.stderr?.on('data', (data: Buffer) => {
      this.emitLog(appId, 'stderr', data.toString())
    })

    // Handle exit
    proc.on('exit', (code) => {
      this.emitLog(appId, 'system', `Process exited with code ${code}`)
      this.running.delete(appId)
      this.assignedPorts.delete(port)
      this.emitStatus({ appId, status: 'stopped' })
    })

    // Handle error
    proc.on('error', (err) => {
      this.emitLog(appId, 'system', `Error: ${err.message}`)
      this.running.delete(appId)
      this.assignedPorts.delete(port)
      this.emitStatus({ appId, status: 'error', error: err.message })
    })

    // For CLI apps or if no ready pattern, emit running after short delay
    if (!config.readyPattern) {
      setTimeout(() => {
        if (this.running.has(appId)) {
          this.emitStatus({ appId, status: 'running' })
        }
      }, 500)
    }

    return info
  }

  /**
   * Stop a running app.
   */
  async stop(appId: string): Promise<void> {
    const entry = this.running.get(appId)
    if (!entry) {
      throw new Error(`App ${appId} is not running`)
    }

    this.emitLog(appId, 'system', 'Stopping process...')
    
    return new Promise((resolve, reject) => {
      const { process: proc, info } = entry

      // Set a timeout for forced kill
      const forceKillTimeout = setTimeout(() => {
        proc.kill('SIGKILL')
      }, 5000)

      proc.once('exit', () => {
        clearTimeout(forceKillTimeout)
        this.running.delete(appId)
        this.assignedPorts.delete(info.port)
        resolve()
      })

      proc.once('error', reject)

      // Try graceful shutdown first
      proc.kill('SIGTERM')
    })
  }

  /**
   * Stop all running apps.
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.running.keys()).map(id => 
      this.stop(id).catch(() => {}) // Ignore errors during cleanup
    )
    await Promise.all(promises)
  }

  /**
   * Check if an app is running.
   */
  isRunning(appId: string): boolean {
    return this.running.has(appId)
  }

  /**
   * Get all running apps.
   */
  getRunning(): Map<string, RunningApp> {
    const result = new Map<string, RunningApp>()
    for (const [id, { info }] of this.running) {
      result.set(id, info)
    }
    return result
  }

  /**
   * Get a running app by ID.
   */
  getRunningApp(appId: string): RunningApp | null {
    return this.running.get(appId)?.info ?? null
  }

  /**
   * Check if a template is runnable.
   */
  isRunnable(template: AppTemplate): boolean {
    return Boolean(RUN_CONFIGS[template]?.command)
  }
}
```

### Update packages/shared/src/apps/index.ts

```typescript
export { AppManager } from './manager'
export { AppRunner } from './runner'
```

### Update packages/shared/src/index.ts

Add the AppRunner export:

```typescript
export { AppRunner } from './apps/runner'
```

---

## Verification Checklist

- [ ] Types added to `packages/core/src/apps.ts`
- [ ] `AppRunner` class created in `packages/shared/src/apps/runner.ts`
- [ ] `packages/shared/src/apps/index.ts` exports `AppRunner`
- [ ] `packages/shared/src/index.ts` exports `AppRunner`
- [ ] `bun run typecheck:all` passes

## Commit Checkpoint

```bash
git add -A
git commit -m "feat(8.1): add running app types and AppRunner

- Add RunningApp, AppLogEntry, AppStatusChange types
- Create AppRunner with start/stop/logs functionality
- Implement port detection to avoid conflicts
- Filter sensitive env vars when spawning processes
- Template-specific run configurations"
```

---

## Next

Proceed to **SESSION-8.2-IPC-AND-PRELOAD.md** to add IPC handlers.
